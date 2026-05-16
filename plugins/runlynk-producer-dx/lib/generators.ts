import type { RunLynkProducerKey, RunLynkWorkerContract } from './core-client';

export type ProducerLanguage = 'typescript' | 'python' | 'curl';

export interface ProducerIntegrationInput {
  projectId: string;
  baseUrl?: string;
  contract: RunLynkWorkerContract;
  producerKey?: RunLynkProducerKey | null;
  language: ProducerLanguage;
}

export function generateProducerSnippet(input: ProducerIntegrationInput): string {
  switch (input.language) {
    case 'python':
      return pythonSnippet(input);
    case 'curl':
      return curlSnippet(input);
    case 'typescript':
    default:
      return typescriptSnippet(input);
  }
}

export function generateProducerPrompt(input: ProducerIntegrationInput): string {
  return [
    `You are integrating a producer application with RunLynk task "${input.contract.task_key}".`,
    '',
    'Goal:',
    '- Submit a job through the Producer API.',
    '- Use an idempotency key for retries.',
    '- Optionally receive callbacks and verify RunLynk signatures.',
    '- Never log or expose the producer API key.',
    '',
    'Producer API:',
    fenced(
      JSON.stringify(
        {
          base_url: input.baseUrl ?? 'http://localhost:8080',
          create_job: `/v1/projects/${input.projectId}/tasks/${input.contract.task_key}/jobs`,
          get_job: `/v1/projects/${input.projectId}/jobs/{job_id}`,
          cancel_job: `/v1/projects/${input.projectId}/jobs/{job_id}/cancel`,
          auth: 'Authorization: Bearer <producer_api_key>',
          idempotency: 'Idempotency-Key: <stable-request-id>',
        },
        null,
        2
      ),
      'json'
    ),
    '',
    'Task Contract:',
    fenced(JSON.stringify(input.contract, null, 2), 'json'),
    '',
    'Implementation requirements:',
    '- Read RUNLYNK_PRODUCER_KEY from environment or a secret manager.',
    '- Submit either input or encrypted_payload, never both.',
    '- If callback_url is configured, verify the callback signature against the raw body.',
    '- Treat RUNNING/WAITING/SCHEDULED as non-terminal states.',
    '- Treat SUCCEEDED, FAILED, and CANCELLED as terminal states.',
  ].join('\n');
}

function typescriptSnippet(input: ProducerIntegrationInput): string {
  const body = { input: input.contract.mock_input };
  return `const baseUrl = process.env.RUNLYNK_CORE_URL ?? ${JSON.stringify(input.baseUrl ?? 'http://localhost:8080')};
const producerKey = process.env.RUNLYNK_PRODUCER_KEY;
if (!producerKey) throw new Error('RUNLYNK_PRODUCER_KEY is required');

async function createRunLynkJob() {
  const response = await fetch(
    \`\${baseUrl}/v1/projects/${input.projectId}/tasks/${encodeURIComponent(input.contract.task_key)}/jobs\`,
    {
      method: 'POST',
      headers: {
        authorization: \`Bearer \${producerKey}\`,
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
      },
      body: JSON.stringify(${JSON.stringify(body, null, 2)}),
    }
  );
  const payload = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(payload));
  return payload;
}

console.log(await createRunLynkJob());
`;
}

function pythonSnippet(input: ProducerIntegrationInput): string {
  const body = { input: input.contract.mock_input };
  return `#!/usr/bin/env python3
import json
import os
import urllib.error
import urllib.parse
import urllib.request
import uuid

BASE_URL = os.environ.get("RUNLYNK_CORE_URL", ${JSON.stringify(input.baseUrl ?? 'http://localhost:8080')})
PRODUCER_KEY = os.environ["RUNLYNK_PRODUCER_KEY"]
PATH = "/v1/projects/${input.projectId}/tasks/" + urllib.parse.quote(${JSON.stringify(input.contract.task_key)}, safe="") + "/jobs"

request = urllib.request.Request(
    BASE_URL.rstrip("/") + PATH,
    data=json.dumps(${JSON.stringify(body, null, 2)}).encode("utf-8"),
    method="POST",
    headers={
        "Authorization": "Bearer " + PRODUCER_KEY,
        "Content-Type": "application/json",
        "Idempotency-Key": str(uuid.uuid4()),
    },
)

try:
    with urllib.request.urlopen(request, timeout=30) as response:
        print(response.read().decode("utf-8"))
except urllib.error.HTTPError as exc:
    raise RuntimeError(exc.read().decode("utf-8")) from exc
`;
}

function curlSnippet(input: ProducerIntegrationInput): string {
  return `curl -sS -X POST "$RUNLYNK_CORE_URL/v1/projects/${input.projectId}/tasks/${input.contract.task_key}/jobs" \\
  -H "Authorization: Bearer $RUNLYNK_PRODUCER_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: $(New-Guid)" \\
  -d '${JSON.stringify({ input: input.contract.mock_input })}'
`;
}

function fenced(value: string, language: string): string {
  return `\`\`\`${language}\n${value}\n\`\`\``;
}
