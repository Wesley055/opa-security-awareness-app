"""Exact approved GitHub results-host transport and temporary NSG contract.
Only hostname/status metadata leaves the probe; signed URLs never leave memory.
"""
import ipaddress
import urllib.parse

HOST = "productionresultssa9.blob.core.windows.net"
SOURCE = "10.72.4.4/32"
PRIORITY = 170
METADATA_RUN = 34819635287
METADATA_JOB = 103897986188


def require(value, code):
    if not value:
        raise RuntimeError(code)


def metadata_host(status, location):
    require(status == 302 and isinstance(location, str), "RESULTS_METADATA_UNAVAILABLE")
    parsed = urllib.parse.urlsplit(location)
    require(parsed.scheme == "https" and parsed.hostname == HOST and
            parsed.port in (None, 443) and parsed.username is None and
            parsed.password is None, "RESULTS_HOST_UNAPPROVED")
    return parsed.hostname


def addresses(values):
    require(isinstance(values, list) and 0 < len(values) <= 32,
            "RESULTS_DNS_ADDRESSES")
    require(len(values) == len(set(values)), "RESULTS_DNS_DUPLICATE")
    for value in values:
        try:
            parsed = ipaddress.ip_address(value)
        except ValueError:
            raise RuntimeError("RESULTS_DNS_ADDRESSES") from None
        require(parsed.version == 4 and parsed.is_global and not parsed.is_multicast and str(parsed) == value,
                "RESULTS_DNS_PUBLIC_IPV4")
    return sorted(values)


def rule(host, values, source=SOURCE):
    require(host == HOST and source == SOURCE, "RESULTS_RULE_BOUNDARY")
    ips = addresses(values)
    return {"properties": {
        "priority": PRIORITY, "direction": "Outbound", "access": "Allow",
        "protocol": "Tcp", "sourceAddressPrefix": SOURCE,
        "sourcePortRange": "*", "destinationPortRange": "443",
        "destinationAddressPrefixes": [ip + "/32" for ip in ips],
        "description": "Temporary approved GitHub results hostname DNS binding"
    }}


def dns_binding(report):
    require(report.get("host") == HOST, "RESULTS_HOST_UNAPPROVED")
    require(report.get("dns") == "PASS", "RESULTS_DNS_FAILURE")
    return addresses(report.get("addresses"))


def unchanged(report, expected):
    require(dns_binding(report) == addresses(expected), "RESULTS_DNS_CHANGED")


def classify(report, expected, nat_ready, rule_matches):
    if report.get("dns") != "PASS":
        return "RESULTS_DNS_FAILURE"
    try:
        unchanged(report, expected)
    except RuntimeError as exc:
        return str(exc)
    if not nat_ready:
        return "RESULTS_NAT_FAILURE"
    if not rule_matches:
        return "RESULTS_NSG_DENY"
    if report.get("tcp443") != "PASS":
        return "RESULTS_TCP_FAILURE"
    if report.get("tls") != "PASS":
        return "RESULTS_TLS_FAILURE"
    if not isinstance(report.get("httpStatus"), int) or not 100 <= report["httpStatus"] <= 599:
        return "RESULTS_HTTP_FAILURE"
    return "PASS"


def rule_matches(actual, expected):
    fields = expected["properties"]
    return all(actual.get("properties", {}).get(k) == v for k, v in fields.items()
               if k != "description")


def payload(host, expected=None, dns_only=False):
    require(host == HOST, "RESULTS_HOST_UNAPPROVED")
    return {"host": host, "expected": addresses(expected) if expected is not None else None,
            "dnsOnly": bool(dns_only)}


# This standard-library-only probe runs as a management command, before JIT launch.
# HEAD / carries no authentication; redirects and response bodies are not followed.
PROBE_SCRIPT = r"""#!/bin/sh
python3 - <<'PY'
import os,json,socket,ssl,re,shutil,subprocess
x=json.loads(os.environ.pop('OPA_PAYLOAD'));h=x['host']
assert h=='productionresultssa9.blob.core.windows.net'
out={'host':h,'dns':'FAIL','tcp443':'NOT_REACHED','tls':'NOT_REACHED','httpStatus':None,'ttlSeconds':None}
try:
 ips=sorted({a[4][0] for a in socket.getaddrinfo(h,443,socket.AF_INET,socket.SOCK_STREAM)})
 out['addresses']=ips;out['dns']='PASS'
 dig=shutil.which('dig')
 if dig:
  d=subprocess.run([dig,'+noall','+answer',h,'A'],capture_output=True,text=True,timeout=5)
  ttl=[int(p[1]) for p in (l.split() for l in d.stdout.splitlines()) if len(p)>=5 and p[3]=='A' and p[1].isdigit()]
  if ttl:out['ttlSeconds']=min(ttl)
 if x['expected'] is not None and ips!=sorted(x['expected']):
  out['failureStage']='DNS_CHANGED'
 elif not x['dnsOnly']:
  for ip in ips:
   out['failureStage']='TCP';out['tcp443']='FAIL'
   with socket.create_connection((ip,443),timeout=5) as c:
    out['tcp443']='PASS';out['failureStage']='TLS';out['tls']='FAIL'
    with ssl.create_default_context().wrap_socket(c,server_hostname=h) as secure:
     out['tls']='PASS';out['failureStage']='HTTP'
     secure.sendall(('HEAD / HTTP/1.1\r\nHost: '+h+'\r\nConnection: close\r\n\r\n').encode())
     first=bytearray()
     while len(first)<256 and not first.endswith(b'\n'):
      b=secure.recv(1)
      if not b:break
      first.extend(b)
     m=re.match(rb'HTTP/1\.[01] ([1-5][0-9][0-9])(?: |\r)',bytes(first))
     if not m:raise RuntimeError('HTTP_STATUS')
     out['httpStatus']=int(m[1]);out['failureStage']=None
except Exception as exc:
 out['exceptionClass']=type(exc).__name__
print('OPA_CONTROL '+json.dumps(out,separators=(',',':')))
PY
"""


# Fixed second transport target; results payload/rule authorization stays exact-host.
ENGINE_HOST = "binaries.prisma.sh"
ENGINE_PROBE_SCRIPT = PROBE_SCRIPT.replace(HOST, ENGINE_HOST)


def engine_payload():
    return {"host": ENGINE_HOST, "expected": None, "dnsOnly": False}


def engine_check(report):
    require(report.get("host") == ENGINE_HOST, "PRISMA_ENGINE_HOST")
    require(report.get("dns") == "PASS", "PRISMA_ENGINE_DNS")
    addresses(report.get("addresses"))
    require(report.get("tcp443") == "PASS", "PRISMA_ENGINE_TCP")
    require(report.get("tls") == "PASS", "PRISMA_ENGINE_TLS")
    require(report.get("failureStage") is None and
            isinstance(report.get("httpStatus"), int) and
            100 <= report["httpStatus"] <= 599, "PRISMA_ENGINE_HTTP")
    return "PASS"
