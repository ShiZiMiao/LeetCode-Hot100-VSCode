
import { AuthManager } from './authManager';
import * as https from 'https';

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
