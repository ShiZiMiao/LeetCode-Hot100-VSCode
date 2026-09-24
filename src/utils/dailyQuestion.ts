/**
 * 每日一题纯逻辑（无 vscode 依赖，src/unit 单测覆盖）
 * 从 Hot 100 静态列表中按日期确定性随机抽一题：同一日期结果固定（每天一题），
 * 跨天轮换；不依赖登录态与网络接口。
 */

import { HOT_100_LIST, Hot100Question } from '../data/hot100Data';

/**
 * 日期字符串 'YYYY-MM-DD' → 稳定伪随机种子（FNV-1a，同输入同输出）。
 * 仅用于把日期映射为固定的抽题索引，不做密码学用途。
 */
export function dateSeed(dateStr: string): number {
    let hash = 2166136261;
    for (let i = 0; i < dateStr.length; i++) {
        hash ^= dateStr.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

/** 按日期从 Hot 100 中确定性抽取一题（同日固定，跨天轮换） */
export function pickDailyQuestion(dateStr: string): Hot100Question {
    return HOT_100_LIST[dateSeed(dateStr) % HOT_100_LIST.length];
}