// The provider-facing tool definitions (name, description, input schema) the chat
// agent exposes. The runtime implementations live in ../tools/; this file is just
// the schemas passed to the model.

export const TOOLS = [
  {
    name: 'search_corpus',
    description:
      "Search Xia's corpus of notes, GitHub source, materials, and websites. Keywords are matched against file content and file paths, literally and case-insensitively. Files are ranked by how many distinct keywords they match. Returns contentHits (lines matching keywords) and pathHits (paths matching keywords).",
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Space-separated keywords, OR\'d. Wrap a multi-word phrase in double quotes to match it exactly.',
        },
        scope: {
          type: 'string',
          description:
            'Optional: a source id from list_sources to search only that source. Omit to search all sources.',
        },
        limit: { type: 'integer', description: 'Max results per list (default 50, max 500).' },
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
    description:
      "List the sources in the corpus. Returns each source's id and root path. Setting scope to a source id also returns that source's file paths.",
    input_schema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          description: "Optional: a source id from list_sources to list only that source. Omit to list all sources.",
        },
      },
    },
  },
];
