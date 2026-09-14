"""Independent cleanup steps; a failed step never suppresses later cleanup."""
import runner_runtime
ORDER=("cancel","stop","database","registration","secrets","iam","network","authorization","vm","nic","disk","nat")
def cleanup(operations,recorder):
    results={}
    for name in ORDER:
        runner_runtime.cleanup_step(name,operations[name],recorder,results)
    return results
