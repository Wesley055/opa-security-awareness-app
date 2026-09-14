import contextlib
import io
import json
import os
import pathlib
import unittest
from unittest import mock
import runner_results_network as n


class Socket:
    def __init__(self):
        self.response = iter(b"HTTP/1.1 403 Forbidden\r\n")
        self.sent = b""

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def sendall(self, data):
        self.sent += data

    def recv(self, count):
        return bytes([next(self.response)])


class Tests(unittest.TestCase):
    def test_metadata_strips_signed_query(self):
        self.assertEqual(n.metadata_host(302, "https://" + n.HOST + "/path?sig=NEVER_PRINT"), n.HOST)
        for url in ["https://opa-production.blob.core.windows.net/x", "http://"+n.HOST, "https://"+n.HOST+".evil.example/x", "https://user:pass@"+n.HOST]:
            with self.subTest(url=url), self.assertRaises(RuntimeError):
                n.metadata_host(302, url)
        with self.assertRaisesRegex(RuntimeError, "METADATA_UNAVAILABLE"):
            n.metadata_host(404, "")

    def test_no_broad_addresses_or_production_source(self):
        for values in [["0.0.0.0/0"], ["10.72.1.4"], ["127.0.0.1"], ["::1"], ["20.209.226.1/24"], ["Storage.EastUS"], ["224.0.0.1"], []]:
            with self.subTest(values=values), self.assertRaises(RuntimeError):
                n.rule(n.HOST, values)
        with self.assertRaises(RuntimeError):
            n.rule(n.HOST, ["20.209.226.1"], "10.72.4.0/28")
        with self.assertRaises(RuntimeError):
            n.rule("opa-production.blob.core.windows.net", ["20.209.226.1"])

    def test_rule_outbound_only_exact_source_port_and_prefixes(self):
        p=n.rule(n.HOST,["20.209.226.129","20.209.226.1"])["properties"]
        self.assertEqual(p["direction"],"Outbound")
        self.assertEqual(p["sourceAddressPrefix"],"10.72.4.4/32")
        self.assertEqual((p["protocol"],p["destinationPortRange"]),("Tcp","443"))
        self.assertEqual(p["destinationAddressPrefixes"],["20.209.226.1/32","20.209.226.129/32"])
        self.assertNotIn("destinationAddressPrefix",p)

    def test_changes_fail_closed(self):
        for ips in [["20.209.226.129"],["20.209.226.1","20.209.226.129"]]:
            with self.assertRaisesRegex(RuntimeError,"DNS_CHANGED"):
                n.unchanged({"host":n.HOST,"dns":"PASS","addresses":ips},["20.209.226.1"])

    def test_failure_classification(self):
        r={"host":n.HOST,"addresses":["20.209.226.1"],"dns":"PASS","tcp443":"PASS","tls":"PASS","httpStatus":403}
        self.assertEqual(n.classify(r,r["addresses"],True,True),"PASS")
        for field,value,code in [("dns","FAIL","DNS"),("tcp443","FAIL","TCP"),("tls","FAIL","TLS"),("httpStatus",None,"HTTP")]:
            self.assertEqual(n.classify(dict(r,**{field:value}),r["addresses"],True,True),"RESULTS_"+code+"_FAILURE")
        self.assertEqual(n.classify(r,r["addresses"],False,True),"RESULTS_NAT_FAILURE")
        self.assertEqual(n.classify(r,r["addresses"],True,False),"RESULTS_NSG_DENY")

    def run_probe(self, dns_error=False):
        script=n.PROBE_SCRIPT.split("<<'PY'\n",1)[1].rsplit("\nPY",1)[0]
        secure=Socket();context=mock.Mock();context.wrap_socket.return_value=secure
        capture=io.StringIO()
        with mock.patch.dict(os.environ,{"OPA_PAYLOAD":json.dumps(n.payload(n.HOST,["20.209.226.1"]))}), mock.patch("socket.getaddrinfo",return_value=[(2,1,6,"",("20.209.226.1",443))],side_effect=OSError("token=NEVER_PRINT") if dns_error else None), mock.patch("socket.create_connection",return_value=Socket()), mock.patch("ssl.create_default_context",return_value=context), mock.patch("shutil.which",return_value=None), contextlib.redirect_stdout(capture):
            exec(compile(script,"probe","exec"),{})
        text=capture.getvalue();self.assertNotIn("NEVER_PRINT",text)
        return json.loads(text.split("OPA_CONTROL ",1)[1]),secure

    def test_real_probe_code_tls_head_only(self):
        report,secure=self.run_probe()
        self.assertEqual(report["httpStatus"],403)
        self.assertEqual(report["tls"],"PASS")
        self.assertEqual(secure.sent,("HEAD / HTTP/1.1\r\nHost: "+n.HOST+"\r\nConnection: close\r\n\r\n").encode())
        self.assertNotIn(b"Authorization",secure.sent)

    def test_probe_redaction_and_dns_stage(self):
        report,_=self.run_probe(True)
        self.assertEqual(report["dns"],"FAIL")
        self.assertEqual(report["exceptionClass"],"OSError")

    def test_preflight_precedes_launch_and_cleanup_owns_rule(self):
        s=pathlib.Path(__file__).with_name("run-azure-validation.py").read_text()
        self.assertLess(s.index("results_network.classify"),s.index("transport.launch("))
        self.assertLess(s.index("temporary.append(result_rule)"),s.index("arm('PUT',result_rule"))
        self.assertIn("results_network.unchanged(observed,results_ips)",s)
        self.assertIn("for i,p in enumerate(temporary)",s)
        self.assertIn("not ip.get('publicIPAddress')",s)
        self.assertIn("'PRODUCTION_IAM'",s)
        self.assertIn("'PRODUCTION_OR_UNKNOWN_ROUTE'",s)

    def test_manifest_and_runtime_contract_match(self):
        m=json.loads(pathlib.Path(__file__).with_name("azure-runner-endpoints.json").read_text())["resultsStorage"]
        self.assertEqual(m["approvedHostname"],n.HOST)
        self.assertEqual(m["evidenceJobId"],n.METADATA_JOB)
        self.assertEqual(m["evidenceRunId"],n.METADATA_RUN)
        self.assertEqual(m["source"],n.SOURCE)
        self.assertEqual(m["priority"],n.PRIORITY)
        self.assertFalse(m["serviceTagsAllowed"])

    def test_cleanup_uses_disk_specific_api(self):
        s=pathlib.Path(__file__).with_name("run-azure-validation.py").read_text()
        self.assertIn('DISKAPI="?api-version=2024-03-02"',s)
        self.assertIn("'disk':lambda:remove(DISK+DISKAPI)",s)
        self.assertNotIn("DISK+COMPAPI",s)

    def test_missing_or_changed_rule_rejected(self):
        expected=n.rule(n.HOST,["20.209.226.1"])
        self.assertTrue(n.rule_matches(expected,expected))
        for key,value in [("direction","Inbound"),("sourceAddressPrefix","*"),("destinationPortRange","*"),("access","Deny")]:
            actual={"properties":dict(expected["properties"],**{key:value})}
            self.assertFalse(n.rule_matches(actual,expected))

if __name__=="__main__":
    unittest.main()
