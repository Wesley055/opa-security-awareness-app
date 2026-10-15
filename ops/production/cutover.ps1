param(
  [Parameter(Mandatory)][string]$SignedReleaseManifest,
  [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$ApprovedManifestSHA256
)
$ErrorActionPreference='Stop'
$taskManifest=(Resolve-Path -LiteralPath $SignedReleaseManifest).Path
$taskActual=(Get-FileHash -LiteralPath $taskManifest -Algorithm SHA256).Hash.ToLowerInvariant()
if($taskActual -cne $ApprovedManifestSHA256){throw 'EXACT_CUTOVER_APPROVAL_REQUIRED'}
$taskPreviousApproval=$env:OPA_EXPLICIT_CUTOVER_APPROVAL_SHA256
$taskPreviousAzureCLI=$env:OPA_OPERATOR_AZ_CLI
try {
  $env:OPA_EXPLICIT_CUTOVER_APPROVAL_SHA256=$ApprovedManifestSHA256
  if(-not $env:OPA_OPERATOR_AZ_CLI){$env:OPA_OPERATOR_AZ_CLI='C:/Program Files/Microsoft SDKs/Azure/CLI2/wbin/az.cmd'}
  & 'C:/Program Files/Microsoft SDKs/Azure/CLI2/python.exe' (Join-Path $PSScriptRoot '../execute-release.py') $taskManifest $ApprovedManifestSHA256
  if($LASTEXITCODE -ne 0){throw 'CUTOVER_FAILED_CHECK_PERSISTED_RECEIPTS'}

  # Read-only post-cutover verification and one consolidated audit receipt.
  if((Get-FileHash -LiteralPath $taskManifest -Algorithm SHA256).Hash.ToLowerInvariant() -cne $ApprovedManifestSHA256){throw 'OWNER_MANIFEST_CHANGED'}
  $taskEnvelope=Get-Content -LiteralPath $taskManifest -Raw | ConvertFrom-Json
  $taskOwner=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($taskEnvelope.payload)) | ConvertFrom-Json
  $taskDirectory=Split-Path -Parent $taskManifest
  $taskPrefix=Join-Path $taskDirectory $taskOwner.releaseId
  $taskDatabase=Get-Content -LiteralPath ($taskPrefix+'.database-phase-receipt.json') -Raw | ConvertFrom-Json
  $taskDeployment=Get-Content -LiteralPath ($taskPrefix+'.cutover-receipt.json') -Raw | ConvertFrom-Json
  $taskRestoration=Get-Content -LiteralPath ($taskPrefix+'.writer-restoration-receipt.json') -Raw | ConvertFrom-Json
  if($taskDatabase.activeMigrations -ne 42 -or $taskDatabase.cleanupRequired -ne $false -or $taskRestoration.status -cne 'writers-restored' -or $taskRestoration.manifestSHA256 -cne $ApprovedManifestSHA256){throw 'FINAL_DATABASE_AND_RESTORATION_PROOF_REQUIRED'}
  $taskRollback=$taskDeployment.status -ceq 'rolled-back'
  if(-not $taskRollback -and $taskDeployment.status -cne 'deployment-phase-complete'){throw 'FINAL_DEPLOYMENT_PROOF_REQUIRED'}
  $taskRuntimeBinding=if($taskRollback){$taskOwner.artifacts.rollbackAuthorization}else{$taskOwner.artifacts.runtimeAuthorization}
  $taskRuntimeFile=Join-Path $taskDirectory $taskRuntimeBinding.path
  if((Get-FileHash -LiteralPath $taskRuntimeFile -Algorithm SHA256).Hash.ToLowerInvariant() -cne $taskRuntimeBinding.sha256){throw 'FINAL_RUNTIME_ARTIFACT_DRIFT'}
  $taskRuntimeEnvelope=Get-Content -LiteralPath $taskRuntimeFile -Raw | ConvertFrom-Json
  $taskRuntime=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($taskRuntimeEnvelope.payload)) | ConvertFrom-Json
  $taskOrigin=$taskRuntime.policy.resources.app.origin
  if($taskOrigin -cnotmatch '^https://opa-api-production(?:-[a-z0-9]+)?(?:\.southafricanorth-01)?\.azurewebsites\.net$'){throw 'FINAL_HEALTH_RESOURCE_BINDING'}
  $taskChecks=[ordered]@{}
  foreach($taskRoute in @('/health','/health/ready','/health/environment')){
    $taskResponse=Invoke-WebRequest -UseBasicParsing -Uri ($taskOrigin+$taskRoute) -TimeoutSec 30 -MaximumRedirection 0
    if([int]$taskResponse.StatusCode -ne 200){throw 'POST_RESTORATION_HEALTH_FAILED'}
    $taskChecks[$taskRoute]=[int]$taskResponse.StatusCode
    if($taskRoute -ceq '/health/environment'){$taskDiagnostic=$taskResponse.Content | ConvertFrom-Json;if($taskDiagnostic.build -cne $taskRuntime.policy.build -or $taskDiagnostic.migrationReadiness -cne 'ready'){throw 'POST_RESTORATION_BUILD_OR_SCHEMA_FAILED'}}
  }
  foreach($taskProbe in @(@{path='/incident-orchestrator/activate';method='POST'},@{path='/journey/safewalk/active';method='GET'},@{path='/incidents/5163fd54-a4b9-4932-b69f-d3c6b92990d9/deliveries';method='GET'})){
    $taskStatus=0
    try{$taskResponse=Invoke-WebRequest -UseBasicParsing -Uri ($taskOrigin+$taskProbe.path) -Method $taskProbe.method -ContentType 'application/json' -TimeoutSec 30 -MaximumRedirection 0;$taskStatus=[int]$taskResponse.StatusCode}
    catch{if($_.Exception.Response){$taskStatus=[int]$_.Exception.Response.StatusCode}else{throw}}
    if($taskStatus -notin @(401,403)){throw 'NON_DISPATCH_ROUTE_GUARD_CHECK_FAILED'}
    $taskChecks[$taskProbe.path]=$taskStatus
  }
  $taskFinal=[ordered]@{version=1;status=$(if($taskRollback){'rolled-back'}else{'complete'});manifestSHA256=$ApprovedManifestSHA256;completedAt=[DateTime]::UtcNow.ToString('o');schema=42;build=$taskRuntime.policy.build;migrationPrivilegesClean=$true;writersRestored=$true;nonDispatchChecks=$taskChecks;realDispatchTestPerformed=$false;databaseReceiptSHA256=(Get-FileHash -LiteralPath ($taskPrefix+'.database-phase-receipt.json') -Algorithm SHA256).Hash.ToLowerInvariant();deploymentReceiptSHA256=(Get-FileHash -LiteralPath ($taskPrefix+'.cutover-receipt.json') -Algorithm SHA256).Hash.ToLowerInvariant();restorationReceiptSHA256=(Get-FileHash -LiteralPath ($taskPrefix+'.writer-restoration-receipt.json') -Algorithm SHA256).Hash.ToLowerInvariant()}
  $taskFinalFile=$taskPrefix+'.production-cutover-receipt.json'
  $taskBytes=[Text.Encoding]::UTF8.GetBytes(($taskFinal | ConvertTo-Json -Depth 8))
  $taskStream=[IO.File]::Open($taskFinalFile,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try{$taskStream.Write($taskBytes,0,$taskBytes.Length);$taskStream.Flush($true)}finally{$taskStream.Dispose()}
  Write-Output ($taskFinal | ConvertTo-Json -Depth 8 -Compress)
} finally {$env:OPA_EXPLICIT_CUTOVER_APPROVAL_SHA256=$taskPreviousApproval;$env:OPA_OPERATOR_AZ_CLI=$taskPreviousAzureCLI}
