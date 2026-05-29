export default function AiRagPage() {
  return {
    title: 'AI RAG Demo',
    message:
      'This demo indexes a source file, builds a RAG context pack and calls the host AI provider.',
    action: 'ask',
    api: '/api/modules/ai-rag-demo/ask',
    costGuard: 'dashboard/API/action all declare a 1 credit commercial guard',
  };
}
