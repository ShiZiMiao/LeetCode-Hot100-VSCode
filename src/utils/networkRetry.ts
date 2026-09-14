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
 * retrySafe 由 requestOnce 在 error 回调里计算并挂到 err 上，request() 据此决定重试。
 */
export function computeRetrySafe(method: string, requestFinished: boolean, errorMessage: string): boolean {
    // 握手阶段断开时服务器必然没收到请求体
    const handshakeOnly = /before secure TLS connection was established|socket disconnected/i.test(errorMessage || '');
    return method === 'GET' || !requestFinished || handshakeOnly;
}
