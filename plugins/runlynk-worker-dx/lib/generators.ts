import type { RunLynkWorkerContract, ValidatorStatus } from './core-client';

export type StarterLanguage = 'python' | 'typescript' | 'http';

export function generateStarter(
  contract: RunLynkWorkerContract,
  language: StarterLanguage
): string {
  switch (language) {
    case 'typescript':
      return typescriptStarter(contract);
    case 'http':
      return httpStarter(contract);
    case 'python':
    default:
      return pythonStarter(contract);
  }
}

export function generateWorkerPrompt(contract: RunLynkWorkerContract): string {
  return [
    `You are building a user-owned RunLynk Worker for task key "${contract.task_key}".`,
    '',
    'Goal:',
    '- Poll RunLynk Core for jobs.',
    '- Renew leases while business work is running.',
    '- Report progress, logs, success, or failure.',
    '- Never leak secrets in logs.',
    '',
    'Worker Contract:',
    fenced(JSON.stringify(contract, null, 2), 'json'),
    '',
    'Implementation requirements:',
    `- Pull from ${contract.worker_protocol.pull}.`,
    `- Renew with ${contract.worker_protocol.renew}.`,
    `- Report success with ${contract.worker_protocol.success}.`,
    `- Report failure with ${contract.worker_protocol.failure}.`,
    `- Lease seconds: ${contract.lease_sec}. Start renew before the lease is close to expiring.`,
    `- Timeout seconds: ${contract.timeout_sec}. Do not run forever.`,
    `- Required tags: ${contract.required_worker_tags.join(', ') || 'none'}.`,
    '- Replace the TODO business logic with the user local script/model/system call.',
    '- Keep the worker process outside RunLynk. RunLynk only coordinates jobs.',
  ].join('\n');
}

export function generateFixPrompt(
  contract: RunLynkWorkerContract,
  status: ValidatorStatus
): string {
  return [
    `The RunLynk validator job for "${contract.task_key}" did not pass.`,
    '',
    'Validator State:',
    fenced(JSON.stringify(status, null, 2), 'json'),
    '',
    'Worker Contract:',
    fenced(JSON.stringify(contract, null, 2), 'json'),
    '',
    'Please inspect the worker code and fix it so that it can:',
    '- Pull exactly one mock job for the task key.',
    '- Renew the lease if work may exceed half the lease duration.',
    '- Report progress and at least one log line.',
    '- Report success with output matching the output schema, or report failure with a useful error.',
  ].join('\n');
}

function pythonStarter(contract: RunLynkWorkerContract): string {
  const tags = JSON.stringify(contract.required_worker_tags);
  return `#!/usr/bin/env python3
import json
import os
import time
import urllib.error
import urllib.request

BASE_URL = os.environ.get("RUNLYNK_CORE_URL", "http://localhost:8080")
TOKEN = os.environ["RUNLYNK_WORKER_TOKEN"]
TASK_KEY = ${JSON.stringify(contract.task_key)}
WORKER_NAME = os.environ.get("RUNLYNK_WORKER_NAME", ${JSON.stringify(`${contract.task_key}-worker`)})
TAGS = ${tags}


def request_json(method, path, body=None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        BASE_URL + path,
        data=data,
        method=method,
        headers={
            "Authorization": "Bearer " + TOKEN,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raise RuntimeError(exc.read().decode("utf-8")) from exc


def process_job(job):
    # TODO: Replace this with your local business logic.
    return {"ok": True, "echo": job.get("input")}


def renew(worker_job_id):
    return request_json("POST", f"/v1/workers/jobs/{worker_job_id}/renew", {
        "extend_by_sec": ${Math.max(1, contract.lease_sec)},
    })


def run_once():
    pulled = request_json("POST", "${contract.worker_protocol.pull}", {
        "tasks": [TASK_KEY],
        "max_jobs": 1,
        "wait_timeout": 0,
        "worker": {
            "name": WORKER_NAME,
            "version": "0.1.0",
            "tags": TAGS,
            "max_concurrent_jobs": 1,
            "metadata": {"source": "runlynk-worker-dx"},
        },
    })
    jobs = pulled.get("jobs", [])
    if not jobs:
        return False

    job = jobs[0]
    worker_job_id = job["worker_job_id"]
    try:
        request_json("POST", f"/v1/workers/jobs/{worker_job_id}/progress", {
            "progress": 25,
            "message": "validator worker started",
        })
        request_json("POST", f"/v1/workers/jobs/{worker_job_id}/logs", {
            "level": "info",
            "message": "processing validator job",
        })
        renew(worker_job_id)
        result = process_job(job)
        request_json("POST", f"/v1/workers/jobs/{worker_job_id}/success", {
            "result": result,
        })
    except Exception as exc:
        request_json("POST", f"/v1/workers/jobs/{worker_job_id}/failure", {
            "error_code": "WORKER_ERROR",
            "error_message": str(exc),
            "retryable": True,
        })
        raise
    return True


while True:
    if not run_once():
        time.sleep(2)
`;
}

function typescriptStarter(contract: RunLynkWorkerContract): string {
  return `const baseUrl = process.env.RUNLYNK_CORE_URL ?? 'http://localhost:8080';
const token = process.env.RUNLYNK_WORKER_TOKEN;
const taskKey = ${JSON.stringify(contract.task_key)};
if (!token) throw new Error('RUNLYNK_WORKER_TOKEN is required');

async function requestJson(path: string, init: RequestInit = {}) {
  const response = await fetch(baseUrl + path, {
    ...init,
    headers: {
      authorization: \`Bearer \${token}\`,
      'content-type': 'application/json',
      accept: 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(JSON.stringify(body));
  return body;
}

async function processJob(job: any) {
  // TODO: Replace this with your local business logic.
  return { ok: true, echo: job.input };
}

async function renew(workerJobId: string) {
  return requestJson(\`/v1/workers/jobs/\${workerJobId}/renew\`, {
    method: 'POST',
    body: JSON.stringify({ extend_by_sec: ${Math.max(1, contract.lease_sec)} }),
  });
}

async function runOnce() {
  const pulled = await requestJson(${JSON.stringify(contract.worker_protocol.pull)}, {
    method: 'POST',
    body: JSON.stringify({
      tasks: [taskKey],
      max_jobs: 1,
      wait_timeout: 0,
      worker: {
        name: process.env.RUNLYNK_WORKER_NAME ?? ${JSON.stringify(`${contract.task_key}-worker`)},
        version: '0.1.0',
        tags: ${JSON.stringify(contract.required_worker_tags)},
        max_concurrent_jobs: 1,
        metadata: { source: 'runlynk-worker-dx' },
      },
    }),
  });
  const job = pulled.jobs?.[0];
  if (!job) return false;
  const workerJobId = job.worker_job_id;
  try {
    await requestJson(\`/v1/workers/jobs/\${workerJobId}/progress\`, {
      method: 'POST',
      body: JSON.stringify({ progress: 25, message: 'validator worker started' }),
    });
    await requestJson(\`/v1/workers/jobs/\${workerJobId}/logs\`, {
      method: 'POST',
      body: JSON.stringify({ level: 'info', message: 'processing validator job' }),
    });
    await renew(workerJobId);
    await requestJson(\`/v1/workers/jobs/\${workerJobId}/success\`, {
      method: 'POST',
      body: JSON.stringify({ result: await processJob(job) }),
    });
  } catch (error) {
    await requestJson(\`/v1/workers/jobs/\${workerJobId}/failure\`, {
      method: 'POST',
      body: JSON.stringify({
        error_code: 'WORKER_ERROR',
        error_message: error instanceof Error ? error.message : String(error),
        retryable: true,
      }),
    });
    throw error;
  }
  return true;
}

setInterval(() => void runOnce(), 2000);
void runOnce();
`;
}

function httpStarter(contract: RunLynkWorkerContract): string {
  return `# Pull one job
curl -sS -X POST "$RUNLYNK_CORE_URL${contract.worker_protocol.pull}" \\
  -H "Authorization: Bearer $RUNLYNK_WORKER_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify({
    tasks: [contract.task_key],
    max_jobs: 1,
    wait_timeout: 0,
    worker: {
      name: `${contract.task_key}-worker`,
      version: '0.1.0',
      tags: contract.required_worker_tags,
      max_concurrent_jobs: 1,
    },
  })}'

# Then call progress/logs/success with the returned worker_job_id.
`;
}

function fenced(value: string, language: string): string {
  return `\`\`\`${language}\n${value}\n\`\`\``;
}
