// One RequestTrace per /chat request: an ordered event log plus a summary,
// written as a single record by the configured sink when the request ends.
// Mode filtering lives here: `metadata` keeps counts, timings, and names only;
// `full` additionally keeps conversation, model, and tool content.

function now() {
  return new Date().toISOString();
}

function errorDetails(error) {
  if (!error) return undefined;
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
}

export class RequestTrace {
  constructor({ mode, write, requestId }) {
    this.write = write;
    this.requestId = requestId;
    this.enabled = mode !== 'off';
    this.full = mode === 'full';
    this.finalized = false;
    this.assistantResponse = '';
    this.record = {
      requestId,
      mode,
      startedAt: now(),
      request: {},
      events: [],
      summary: {},
    };
  }

  setRequest(payload) {
    if (!this.enabled) return;
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    Object.assign(this.record.request, {
      model: payload.model ?? null,
      messageCount: messages.length,
      ...(this.full ? { messages: structuredClone(messages) } : {}),
    });
  }

  // `fullDetails` is snapshotted, so callers may pass mutable state (e.g. the
  // provider conversation) without later rounds rewriting earlier events.
  appendEvent(type, metadata = {}, fullDetails = {}) {
    if (!this.enabled) return;
    this.record.events.push({
      type,
      at: now(),
      ...metadata,
      ...(this.full ? structuredClone(fullDetails) : {}),
    });
  }

  incrementSummaryMetric(field, amount = 1) {
    if (!this.enabled) return;
    this.record.summary[field] = (this.record.summary[field] || 0) + amount;
  }

  setSummaryMetric(field, value) {
    if (!this.enabled) return;
    this.record.summary[field] = value;
  }

  incrementSummaryTokenUsage(usage = {}) {
    if (!this.enabled) return;
    this.incrementSummaryMetric('inputTokens', usage.input_tokens ?? 0);
    this.incrementSummaryMetric('outputTokens', usage.output_tokens ?? 0);
  }

  appendSummaryAssistantResponse(text) {
    if (!this.enabled || !text) return;
    if (this.full) this.assistantResponse += text;
  }

  async finalize(status, error) {
    if (!this.enabled || this.finalized) return;
    this.finalized = true;
    const finishedAt = now();
    const durationMs = Date.parse(finishedAt) - Date.parse(this.record.startedAt);
    const details = errorDetails(error);

    this.appendEvent(`request.${status}`, {
      durationMs,
      ...(details ? { error: details } : {}),
    });
    this.record.finishedAt = finishedAt;
    this.record.status = status;
    this.record.summary.durationMs = durationMs;
    if (this.full) {
      this.record.summary.assistantResponse = this.assistantResponse;
    }
    try {
      await this.write(this.record);
    } catch (sinkError) {
      console.error(
        `Chat log write failed for ${this.requestId}: ${sinkError.message}`,
      );
    }
  }
}
