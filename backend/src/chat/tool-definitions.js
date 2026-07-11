// The provider-facing tool definitions (name, description, input schema) the chat
// agent exposes. The runtime implementations live in ../tools/; this file is just
// the schemas passed to the model.

export const TOOLS = [
  {
    name: 'search_corpus',
    description:
      "Search Xia's corpus (notes + GitHub source) for a query. Call this before answering any factual question about Xia's work. Returns matching files with line numbers and snippets.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query (keywords or a phrase).' },
        scope: {
          type: 'string',
          description:
            "Where to search: 'all' (default), 'notes', 'github', or 'resume'.",
        },
        limit: { type: 'integer', description: 'Max results (default 20).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_file',
    description:
      'Read a window of lines from a corpus file (use the path from a search result) to read the passage you will cite.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Corpus-relative path from a search result.' },
        start_line: { type: 'integer', description: 'First line to read (1-based).' },
        line_count: { type: 'integer', description: 'How many lines to read.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_sources',
    description: 'List the sources in the corpus and their sizes.',
    input_schema: {
      type: 'object',
      properties: {
        scope: { type: 'string', description: "Optional: 'all', 'notes', 'github', 'resume'." },
      },
    },
  },
];
