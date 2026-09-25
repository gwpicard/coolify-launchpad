/**
 * Streamed during a launch so the dispatcher can print structured milestones
 * instead of raw Pulumi or SSH output. The skill reads these to tell the
 * person where the launch is.
 */
export interface ProgressEvent {
    /** The step's name as the person reads it, for example "Creating the server". */
    step: string;
    status: "started" | "done" | "skipped" | "failed";
    /** One line of detail: an address, a duration, or the error's first line. */
    detail?: string;
    /** Set on done, skipped and failed: wall-clock time since the step started. */
    durationMs?: number;
}

export type OnProgress = (e: ProgressEvent) => void;

/**
 * Wrap a step with its started and done events and its timing. A thrown error
 * becomes a failed event carrying the error's first line, then is thrown on.
 */
export async function step<T>(
    onProgress: OnProgress | undefined,
    label: string,
    fn: () => Promise<T> | T,
    describe?: (result: T) => string | undefined,
): Promise<T> {
    const start = Date.now();
    onProgress?.({ step: label, status: "started" });
    try {
        const result = await fn();
        const detail = describe?.(result);
        onProgress?.({ step: label, status: "done", durationMs: Date.now() - start, ...(detail ? { detail } : {}) });
        return result;
    } catch (err) {
        onProgress?.({
            step: label,
            status: "failed",
            durationMs: Date.now() - start,
            detail: err instanceof Error ? err.message.split("\n")[0] : String(err),
        });
        throw err;
    }
}
