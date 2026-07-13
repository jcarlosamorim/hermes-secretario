// Cliente minimo da API GraphQL do Fireflies (so a query que precisamos).
// Docs: https://docs.fireflies.ai/graphql-api/query/transcript
//
// Gotchas conhecidos (aprendidos no sistema original):
//   - summary.action_items e uma STRING unica em blocos por pessoa
//     ("**Nome**\ntarefa (mm:ss)"), NAO um array. O (mm:ss) e timestamp
//     da call, nunca prazo.
//   - transcript.date vem em epoch MILISSEGUNDOS.
//   - Plano Free: 50 chamadas/dia.

const GRAPHQL_URL = 'https://api.fireflies.ai/graphql';

const TRANSCRIPT_QUERY = `
  query Transcript($id: String!) {
    transcript(id: $id) {
      id
      title
      date
      summary {
        overview
        action_items
      }
      meeting_attendees {
        displayName
        email
      }
    }
  }
`;

export async function fetchTranscriptSummary(meetingId) {
  const apiKey = process.env.FIREFLIES_API_KEY;
  if (!apiKey) throw new Error('Missing FIREFLIES_API_KEY');

  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query: TRANSCRIPT_QUERY, variables: { id: meetingId } }),
  });

  const body = await res.json();
  if (!res.ok || body.errors) {
    throw new Error(`Fireflies API ${res.status}: ${JSON.stringify(body.errors || body)}`);
  }
  return body.data?.transcript || null;
}
