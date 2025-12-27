
import * as vscode from 'vscode';

export class AuthManager {
    private static readonly KEY_LEETCODE_COOKIE = 'leetcode_session_cookie';
    private context: vscode.ExtensionContext;
    private _onDidChangeLoginStatus: vscode.EventEmitter<boolean> = new vscode.EventEmitter<boolean>();
    public readonly onDidChangeLoginStatus: vscode.Event<boolean> = this._onDidChangeLoginStatus.event;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    async setCookie(cookie: string): Promise<void> {
        await this.context.secrets.store(AuthManager.KEY_LEETCODE_COOKIE, cookie);
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
}
