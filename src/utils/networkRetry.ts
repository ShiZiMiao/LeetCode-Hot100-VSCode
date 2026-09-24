/**
 * 网络层纯逻辑：瞬时故障判定与重试幂等判定。
 * 独立于 leetcodeApi.ts（其依赖 authManager → vscode），让单测能直接覆盖。
 */

/** 网络层瞬断（代理/中间设备切断 TLS 握手或未发出请求体）是否值得重试。 */
export function isTransientNetworkError(err: any): boolean {
    const msg = String(err?.message || '');
    const code = String(err?.code || '');
    return /before secure TLS connection was established|socket disconnected|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ETIMEDOUT|ENOTFOUND|socket hang up|请求超时/i.test(msg)
        || ['ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ETIMEDOUT', 'ENOTFOUND'].includes(code);
}

/**
 * 失败请求是否可安全重试（幂等判定）：GET 恒可重试；POST 仅在请求体尚未完整发出
 * 或握手未建立时重试，避免提交类接口重复执行。
 * retrySafe 由 attachRetrySafe 在 error 回调里计算并挂到 err 上，request() 据此决定重试。
 */
export function computeRetrySafe(method: string, requestFinished: boolean, errorMessage: string): boolean {
    // 握手阶段断开时服务器必然没收到请求体
    const handshakeOnly = /before secure TLS connection was established|socket disconnected/i.test(errorMessage || '');
    return method === 'GET' || !requestFinished || handshakeOnly;
}

/** 携带重试安全标记的错误类型（跨模块重试契约的唯一载体） */
export type RetrySafeError = Error & { retrySafe?: boolean };

/**
 * 给错误挂上 retrySafe 标记（computeRetrySafe 为唯一判定源）：
 * requestOnce 在 error 回调调用，request() 读取 err.retrySafe 决定是否重试。
 */
export function attachRetrySafe(err: unknown, method: string, requestFinished: boolean): RetrySafeError {
    const e: RetrySafeError = err instanceof Error ? err : new Error(String(err));
    e.retrySafe = computeRetrySafe(method, requestFinished, e.message);
    return e;
}

/**
 * 对瞬断类错误做有限重试（GET 幂等下载专用：图片/HLS 分段/VOD 请求）。
 * 非瞬断错误（HTTP 4xx/5xx、安全校验拒绝等）立即抛出；间隔 500ms×attempt 递增。
 */
export async function retryTransient<T>(fn: () => Promise<T>, maxAttempts: number = 3, delayMs: number = 500): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (e) {
            lastErr = e;
            if (!isTransientNetworkError(e) || attempt >= maxAttempts - 1) {
                throw lastErr;
            }
            await new Promise(r => setTimeout(r, delayMs * (attempt + 1)));
        }
    }
    throw lastErr;
}
