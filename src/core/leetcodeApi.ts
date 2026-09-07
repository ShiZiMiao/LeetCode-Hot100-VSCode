
import { AuthManager } from './authManager';
import * as https from 'https';
import * as crypto from 'crypto';

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export interface Question {
    frontendQuestionId: string;
    title: string;
    titleSlug: string;
    difficulty: string;
    status: string | null;
}

export class LeetCodeApi {
    private static readonly HOSTNAME = 'leetcode.cn';
    private authManager: AuthManager;

    constructor(authManager: AuthManager) {
        this.authManager = authManager;
    }

    private async getHeaders(): Promise<Record<string, string>> {
        const cookie = await this.authManager.getCookie();
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36 VSCode-LeetCode-Extension',
            'Origin': `https://${LeetCodeApi.HOSTNAME}`,
            'Referer': `https://${LeetCodeApi.HOSTNAME}`
        };
        if (cookie) {
            headers['Cookie'] = cookie;
            const match = cookie.match(/csrftoken=([^;]+)/);
            if (match) {
                headers['x-csrftoken'] = match[1];
            }
        }
        return headers;
    }

    private request(method: string, path: string, data?: any): Promise<any> {
        return new Promise(async (resolve, reject) => {
            const headers = await this.getHeaders();

            const options: https.RequestOptions = {
                hostname: LeetCodeApi.HOSTNAME,
                port: 443,
                path: path,
                method: method,
                headers: headers,
                rejectUnauthorized: false // Bypass SSL checks for stability in proxy environments
            };

            const req = https.request(options, (res) => {
                let body = '';
                res.on('data', (chunk) => body += chunk);
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            resolve(JSON.parse(body));
                        } catch (e) {
                            resolve(body); // Fallback for non-JSON
                        }
                    } else {
                        reject(new Error(`Request failed with status ${res.statusCode}: ${body}`));
                    }
                });
            });

            req.on('error', (e) => {
                reject(e);
            });

            if (data) {
                req.write(JSON.stringify(data));
            }
            req.end();
        });
    }

    async postGraphql(query: string, variables: any = {}): Promise<any> {
        return this.request('POST', '/graphql', { query, variables });
    }

    async post(url: string, data: any): Promise<any> {
        // Ensure url is just the path
        const path = url.startsWith('http') ? new URL(url).pathname : url;
        return this.request('POST', path, data);
    }

    async get(url: string): Promise<any> {
        const path = url.startsWith('http') ? new URL(url).pathname : url;
        return this.request('GET', path);
    }

    /**
     * 获取题解视频的播放信息（阿里云 VOD：playAuth 凭证 + videoId + 封面）。
     * 题解 Markdown 中的 ![xxx.mp4](uuid) 即 uuid 参数；前端网页用
     * Aliplayer（vid + playauth）播放，普通 <video> 直链不可用（video.leetcode.cn 已废弃且 403）。
     */
    async getVideoInfo(uuid: string): Promise<any> {
        const query = `
            query videoInfo($uuid: UUID!) {
                videosVideoInfo(uuid: $uuid, fetchType: PLAY_AUTH) {
                    playAuth
                    status
                    videoInfo {
                        videoId
                        coverUrl
                    }
                    videoSize {
                        width
                        height
                    }
                    articleChargeType
                    canSee
                }
            }
        `;
        return this.postGraphql(query, { uuid });
    }

    /**
     * 下载并合并视频的 HLS 分段为连续 TS 文件（webview 的 MSE 在部分环境不可用，
     * 原生 <video> 可直接播放连续 TS）。返回 Buffer，由调用方缓存到磁盘。
     */
    async getVideoMergedTs(uuid: string): Promise<{ buffer: Buffer; videoId: string; coverUrl: string; playAuth: string }> {
        const play = await this.getVideoPlayUrl(uuid);
        if (!/\.m3u8(\?|$)/i.test(play.videoUrl)) {
            // 非 HLS 直接返回（mp4 等原生可播）
            return { buffer: await this.downloadBinaryRaw(play.videoUrl), videoId: play.videoId, coverUrl: play.coverUrl, playAuth: play.playAuth };
        }
        const m3u8 = await this.getFullText(play.videoUrl);
        const segUrls = m3u8.split('\n')
            .map(l => l.trim())
            .filter(l => l && !l.startsWith('#'))
            .map(l => new URL(l, play.videoUrl).toString());
        if (segUrls.length === 0) {
            throw new Error('HLS 清单为空');
        }
        // 顺序下载并合并（分段较小，避免并发打爆连接）
        const chunks: Buffer[] = [];
        const concurrency = 4;
        let idx = 0;
        const api = this;
        async function worker(): Promise<void> {
            while (idx < segUrls.length) {
                const cur = idx++;
                chunks[cur] = await api.downloadBinaryRaw(segUrls[cur]);
            }
        }
        await Promise.all(Array.from({ length: Math.min(concurrency, segUrls.length) }, () => worker()));
        const total = chunks.reduce((s, c) => s + c.length, 0);
        if (total === 0) {
            throw new Error('视频分段下载为空');
        }
        return { buffer: Buffer.concat(chunks, total), videoId: play.videoId, coverUrl: play.coverUrl, playAuth: play.playAuth };
    }

    /** 获取完整 URL 的文本内容（m3u8 清单等非 JSON 响应） */
    async getFullText(url: string): Promise<string> {
        const u = new URL(url);
        return new Promise((resolve, reject) => {
            const req = https.request(
                {
                    hostname: u.hostname,
                    port: 443,
                    path: u.pathname + u.search,
                    method: 'GET',
                    headers: { 'User-Agent': BROWSER_UA, 'Accept': '*/*' },
                    rejectUnauthorized: false
                },
                (res) => {
                    let body = '';
                    res.on('data', (chunk) => body += chunk);
                    res.on('end', () => {
                        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                            resolve(body);
                        } else {
                            reject(new Error(`请求失败 status ${res.statusCode}`));
                        }
                    });
                }
            );
            req.on('error', reject);
            req.end();
        });
    }

    /** 下载完整 URL 的二进制内容（HLS 分段等） */
    async downloadBinaryRaw(url: string): Promise<Buffer> {
        const u = new URL(url);
        return new Promise((resolve, reject) => {
            const req = https.request(
                {
                    hostname: u.hostname,
                    port: 443,
                    path: u.pathname + u.search,
                    method: 'GET',
                    headers: { 'User-Agent': BROWSER_UA, 'Accept': '*/*' },
                    rejectUnauthorized: false
                },
                (res) => {
                    if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                        const next = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).toString();
                        req.destroy();
                        resolve(this.downloadBinaryRaw(next));
                        return;
                    }
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        const chunks: Buffer[] = [];
                        res.on('data', (chunk) => chunks.push(chunk));
                        res.on('end', () => resolve(Buffer.concat(chunks)));
                    } else {
                        reject(new Error(`下载失败 status ${res.statusCode}`));
                    }
                }
            );
            req.on('error', reject);
            req.end();
        });
    }

    /**
     * 请求完整 URL（保留 host、path 与 query），用于阿里云 VOD 等非 leetcode.cn 域名。
     * 与 request/get 不同：不剥 query、不改 host。
     */
    async getFullUrl(url: string): Promise<any> {
        const u = new URL(url);
        return new Promise((resolve, reject) => {
            const req = https.request(
                {
                    hostname: u.hostname,
                    port: 443,
                    path: u.pathname + u.search,
                    method: 'GET',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
                        'Accept': 'application/json'
                    },
                    rejectUnauthorized: false
                },
                (res) => {
                    let body = '';
                    res.on('data', (chunk) => body += chunk);
                    res.on('end', () => {
                        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                            try {
                                resolve(JSON.parse(body));
                            } catch (e) {
                                reject(new Error(`响应非 JSON: ${body.slice(0, 200)}`));
                            }
                        } else {
                            reject(new Error(`请求失败 status ${res.statusCode}: ${body.slice(0, 200)}`));
                        }
                    });
                }
            );
            req.on('error', reject);
            req.end();
        });
    }

    /**
     * 换取视频真实播放地址（阿里云 VOD GetPlayInfo，与网页端 Aliplayer 同款签名流程）。
     * playAuth 解码后含临时 AccessKey/AuthInfo，签名请求 vod.{region}.aliyuncs.com，
     * 返回签名后的 PlayURL（通常是 m3u8，需 hls.js 播放）。
     */
    async getVideoPlayUrl(uuid: string): Promise<{ videoUrl: string; videoId: string; coverUrl: string; playAuth: string }> {
        const data = await this.getVideoInfo(uuid);
        const info = data?.data?.videosVideoInfo;
        if (!info?.playAuth || !info?.videoInfo?.videoId) {
            throw new Error('未获取到播放凭证');
        }
        const decoded = JSON.parse(Buffer.from(info.playAuth, 'base64').toString('utf8'));
        const enc = (s: string) => encodeURIComponent(s).replace(/\+/g, '%20').replace(/\*/g, '%2A').replace(/%7E/g, '~');
        const params: Record<string, string> = {
            AccessKeyId: decoded.AccessKeyId,
            Action: 'GetPlayInfo',
            VideoId: info.videoInfo.videoId,
            AuthTimeout: '172800',
            Rand: crypto.randomUUID().slice(0, 16),
            SecurityToken: decoded.SecurityToken,
            Format: 'JSON',
            Version: '2017-03-21',
            SignatureMethod: 'HMAC-SHA1',
            SignatureVersion: '1.0',
            SignatureNonce: crypto.randomUUID(),
            PlayerVersion: '2.9.2',
            Channel: 'HTML5',
            AuthInfo: decoded.AuthInfo
        };
        const qs = Object.keys(params).sort().map(k => `${enc(k)}=${enc(params[k])}`).join('&');
        const stringToSign = `GET&${enc('/')}&${enc(qs)}`;
        const signature = crypto.createHmac('sha1', decoded.AccessKeySecret + '&').update(stringToSign).digest('base64');
        const url = `https://vod.${decoded.Region || 'cn-shanghai'}.aliyuncs.com/?${qs}&Signature=${enc(signature)}`;
        // 注意：签名在 query 里，且域名是 vod.aliyuncs.com，不能经 get()/request()
        //（会剥掉 query / 改 host），必须保留完整 host+path+query
        const res = await this.getFullUrl(url);
        const playInfos = res?.PlayInfoList?.PlayInfo || [];
        const picked = playInfos.find((p: any) => p.Format === 'mp4') || playInfos.find((p: any) => p.Format === 'm3u8') || playInfos[0];
        if (!picked?.PlayURL) {
            throw new Error('未获取到视频地址');
        }
        return {
            videoUrl: picked.PlayURL,
            videoId: info.videoInfo.videoId,
            coverUrl: info.videoInfo.coverUrl || '',
            playAuth: info.playAuth
        };
    }

    async getUserProfile(): Promise<any> {
        // 使用 globalData 查询获取用户状态（参考 leetcode-runner 的 USER_STATUS_QUERY）
        const query = `
            query globalData {
                userStatus {
                    isSignedIn
                    isPremium
                    username
                    realName
                    avatar
                    userSlug
                    isAdmin
                    useTranslation
                    premiumExpiredAt
                    isTranslator
                    isSuperuser
                    isPhoneVerified
                    isVerified
                }
            }
        `;
        return this.postGraphql(query);
    }

    async getHot100Problems(): Promise<Question[]> {
        // 参考 leetcode-runner 项目的 PROBLEM_SET_QUERY
        const query = `
            query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
                problemsetQuestionList(
                    categorySlug: $categorySlug
                    limit: $limit
                    skip: $skip
                    filters: $filters
                ) {
                    hasMore
                    total
                    questions {
                        acRate
                        difficulty
                        freqBar
                        frontendQuestionId
                        isFavor
                        paidOnly
                        solutionNum
                        status
                        title
                        titleCn
                        titleSlug
                        topicTags {
                            name
                            nameTranslated
                            id
                            slug
                        }
                    }
                }
            }
        `;

        const variables = {
            categorySlug: "",
            skip: 0,
            limit: 3000, // 增大limit确保覆盖所有Hot 100题目
            filters: {}
        };

        const result = await this.postGraphql(query, variables);
        const questions = result.data?.problemsetQuestionList?.questions || [];

        // 映射为 Question 接口格式
        return questions.map((q: any) => ({
            frontendQuestionId: q.frontendQuestionId,
            title: q.titleCn || q.title,  // 优先使用中文标题
            titleSlug: q.titleSlug,
            difficulty: q.difficulty,
            status: q.status
        }));
    }

    async getQuestionContent(titleSlug: string): Promise<any> {
        // 参考 leetcode-runner 项目的 QUESTION_DATA_QUERY
        const query = `
            query questionData($titleSlug: String!) {
                question(titleSlug: $titleSlug) {
                    questionId
                    questionFrontendId
                    categoryTitle
                    boundTopicId
                    title
                    titleSlug
                    content
                    translatedTitle
                    translatedContent
                    isPaidOnly
                    difficulty
                    likes
                    dislikes
                    isLiked
                    similarQuestions
                    topicTags {
                        name
                        slug
                        translatedName
                    }
                    codeSnippets {
                        lang
                        langSlug
                        code
                    }
                    stats
                    hints
                    status
                    sampleTestCase
                    metaData
                    mysqlSchemas
                    exampleTestcases
                }
            }
        `;
        return this.postGraphql(query, { titleSlug });
    }

    async submitCode(titleSlug: string, questionId: string, lang: string, typedCode: string): Promise<any> {
        const url = `/problems/${titleSlug}/submit/`;
        const data = {
            lang: lang,
            question_id: questionId,
            typed_code: typedCode
        };
        return this.post(url, data);
    }

    async checkSubmission(submissionId: string): Promise<any> {
        return this.get(`/submissions/detail/${submissionId}/check/`);
    }

    /**
     * 运行测试用例
     */
    async runCode(titleSlug: string, questionId: string, lang: string, typedCode: string, dataInput: string): Promise<any> {
        const url = `/problems/${titleSlug}/interpret_solution/`;
        const data = {
            lang: lang,
            question_id: questionId,
            typed_code: typedCode,
            data_input: dataInput
        };
        return this.post(url, data);
    }

    /**
     * 获取题目的官方题解
     */
    async getOfficialSolution(titleSlug: string): Promise<any> {
        const query = `
            query officialSolution($titleSlug: String!) {
                question(titleSlug: $titleSlug) {
                    solution {
                        id
                        title
                        content
                        contentTypeId
                        canSeeDetail
                    }
                }
            }
        `;
        return this.postGraphql(query, { titleSlug });
    }

    /**
     * 获取社区题解列表
     */
    async getSolutionArticles(titleSlug: string, skip: number = 0, limit: number = 10): Promise<any> {
        const query = `
            query questionSolutionArticles($questionSlug: String!, $skip: Int, $first: Int, $orderBy: SolutionArticleOrderBy, $userInput: String, $tagSlugs: [String!]) {
                questionSolutionArticles(
                    questionSlug: $questionSlug
                    skip: $skip
                    first: $first
                    orderBy: $orderBy
                    userInput: $userInput
                    tagSlugs: $tagSlugs
                ) {
                    totalNum
                    edges {
                        node {
                            uuid
                            title
                            slug
                            summary
                            author {
                                username
                                profile {
                                    realName
                                    userAvatar
                                }
                            }
                            byLeetcode
                            isMyFavorite
                            isMostPopular
                            isEditorsPick
                            topic {
                                id
                            }
                            upvoteCount
                            reactionsV2 {
                                count
                                reactionType
                            }
                            tags {
                                name
                                nameTranslated
                                slug
                            }
                            createdAt
                            thumbnail
                        }
                    }
                }
            }
        `;
        return this.postGraphql(query, {
            questionSlug: titleSlug,
            skip,
            first: limit,
            orderBy: 'MOST_UPVOTE'
        });
    }

    /**
     * 获取单个题解详情
     */
    async getSolutionArticle(slug: string): Promise<any> {
        const query = `
            query solutionArticleContent($slug: String!) {
                solutionArticle(slug: $slug) {
                    uuid
                    title
                    content
                    author {
                        username
                        profile {
                            realName
                            userAvatar
                        }
                    }
                    byLeetcode
                    upvoteCount
                    createdAt
                    tags {
                        name
                        nameTranslated
                        slug
                    }
                }
            }
        `;
        return this.postGraphql(query, { slug });
    }
}
