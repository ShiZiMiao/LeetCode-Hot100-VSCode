
import * as vscode from 'vscode';

export class AuthManager implements vscode.Disposable {
    private static readonly KEY_LEETCODE_COOKIE = 'leetcode_session_cookie';
    private context: vscode.ExtensionContext;
    private _onDidChangeLoginStatus: vscode.EventEmitter<boolean> = new vscode.EventEmitter<boolean>();
    public readonly onDidChangeLoginStatus: vscode.Event<boolean> = this._onDidChangeLoginStatus.event;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        // Event 生命周期随扩展停用释放
        context.subscriptions.push(this);
    }

    async setCookie(cookie: string): Promise<void> {
        await this.context.secrets.store(AuthManager.KEY_LEETCODE_COOKIE, cookie);
        // 注意：这里不发"已登录"事件——completeLogin 先存后校验，校验通过才
        // markLoginVerified()，避免失败路径闪一次"已登录"再被 logout 撤回
    }

    /** 登录校验通过后由调用方触发"已登录"事件 */
    markLoginVerified(): void {
        this._onDidChangeLoginStatus.fire(true);
    }

    async getCookie(): Promise<string | undefined> {
        return await this.context.secrets.get(AuthManager.KEY_LEETCODE_COOKIE);
    }

    async logout(): Promise<void> {
        await this.context.secrets.delete(AuthManager.KEY_LEETCODE_COOKIE);
        this._onDidChangeLoginStatus.fire(false);
    }

    async isLoggedIn(): Promise<boolean> {
        const cookie = await this.getCookie();
        return !!cookie;
    }

    dispose(): void {
        this._onDidChangeLoginStatus.dispose();
    }
}
