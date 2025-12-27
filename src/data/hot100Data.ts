/**
 * LeetCode Hot 100 题目列表数据
 * 数据来源：hot100.csv
 */

export interface Hot100Question {
    category: string;           // 分类（中英文）
    frontendQuestionId: string; // 题目序号
    titleSlug: string;          // 题目slug（用于API查询）
    titleCn: string;            // 中文标题
    titleEn: string;            // 英文标题
}

// 分类顺序（保持CSV中的顺序）
export const CATEGORIES: string[] = [
    "哈希 (Hash)",
    "双指针 (Two Pointers)",
    "滑动窗口 (Sliding Window)",
    "子串 (Substrings)",
    "数组 (Array)",
    "矩阵 (Matrix)",
    "链表 (Linked List)",
    "二叉树 (Binary Tree)",
    "图论 (Graph)",
    "回溯 (Backtracking)",
    "二分查找 (Binary Search)",
    "栈 (Stack)",
    "堆 (Heap)",
    "贪心 (Greedy)",
    "动态规划 (Dynamic Programming)",
    "多维动态规划 (Multi-dimensional DP)",
    "技巧 (Bit Manipulation / Math)"
];

// Hot 100 题目 ID 集合（用于快速查找）
export const HOT_100_IDS: Set<string> = new Set([
    "1", "49", "128", "283", "11", "15", "42", "3", "438", "560", "239", "76",
    "53", "56", "189", "238", "41", "73", "54", "48", "240", "160", "206", "234",
    "141", "142", "21", "2", "19", "24", "25", "138", "148", "23", "146", "94",
    "104", "226", "101", "543", "102", "108", "98", "230", "199", "114", "105",
    "437", "236", "124", "200", "994", "207", "208", "46", "78", "17", "39", "22",
    "79", "131", "51", "35", "74", "34", "33", "153", "4", "20", "155", "394",
    "739", "84", "215", "347", "295", "121", "55", "45", "763", "70", "118", "198",
    "279", "322", "139", "300", "416", "32", "62", "64", "5", "1143", "72", "136",
    "169", "75", "31", "287"
]);

// 题目ID到titleSlug的映射（用于API查询）
export const ID_TO_SLUG: Map<string, string> = new Map([
    ["1", "two-sum"],
    ["49", "group-anagrams"],
    ["128", "longest-consecutive-sequence"],
    ["283", "move-zeroes"],
    ["11", "container-with-most-water"],
    ["15", "3sum"],
    ["42", "trapping-rain-water"],
    ["3", "longest-substring-without-repeating-characters"],
    ["438", "find-all-anagrams-in-a-string"],
    ["560", "subarray-sum-equals-k"],
    ["239", "sliding-window-maximum"],
    ["76", "minimum-window-substring"],
    ["53", "maximum-subarray"],
    ["56", "merge-intervals"],
    ["189", "rotate-array"],
    ["238", "product-of-array-except-self"],
    ["41", "first-missing-positive"],
    ["73", "set-matrix-zeroes"],
    ["54", "spiral-matrix"],
    ["48", "rotate-image"],
    ["240", "search-a-2d-matrix-ii"],
    ["160", "intersection-of-two-linked-lists"],
    ["206", "reverse-linked-list"],
    ["234", "palindrome-linked-list"],
    ["141", "linked-list-cycle"],
    ["142", "linked-list-cycle-ii"],
    ["21", "merge-two-sorted-lists"],
    ["2", "add-two-numbers"],
    ["19", "remove-nth-node-from-end-of-list"],
    ["24", "swap-nodes-in-pairs"],
    ["25", "reverse-nodes-in-k-group"],
    ["138", "copy-list-with-random-pointer"],
    ["148", "sort-list"],
    ["23", "merge-k-sorted-lists"],
    ["146", "lru-cache"],
    ["94", "binary-tree-inorder-traversal"],
    ["104", "maximum-depth-of-binary-tree"],
    ["226", "invert-binary-tree"],
    ["101", "symmetric-tree"],
    ["543", "diameter-of-binary-tree"],
    ["102", "binary-tree-level-order-traversal"],
    ["108", "convert-sorted-array-to-binary-search-tree"],
    ["98", "validate-binary-search-tree"],
    ["230", "kth-smallest-element-in-a-bst"],
    ["199", "binary-tree-right-side-view"],
    ["114", "flatten-binary-tree-to-linked-list"],
    ["105", "construct-binary-tree-from-preorder-and-inorder-traversal"],
    ["437", "path-sum-iii"],
    ["236", "lowest-common-ancestor-of-a-binary-tree"],
    ["124", "binary-tree-maximum-path-sum"],
    ["200", "number-of-islands"],
    ["994", "rotting-oranges"],
    ["207", "course-schedule"],
    ["208", "implement-trie-prefix-tree"],
    ["46", "permutations"],
    ["78", "subsets"],
    ["17", "letter-combinations-of-a-phone-number"],
    ["39", "combination-sum"],
    ["22", "generate-parentheses"],
    ["79", "word-search"],
    ["131", "palindrome-partitioning"],
    ["51", "n-queens"],
    ["35", "search-insert-position"],
    ["74", "search-a-2d-matrix"],
    ["34", "find-first-and-last-position-of-element-in-sorted-array"],
    ["33", "search-in-rotated-sorted-array"],
    ["153", "find-minimum-in-rotated-sorted-array"],
    ["4", "median-of-two-sorted-arrays"],
    ["20", "valid-parentheses"],
    ["155", "min-stack"],
    ["394", "decode-string"],
    ["739", "daily-temperatures"],
    ["84", "largest-rectangle-in-histogram"],
    ["215", "kth-largest-element-in-an-array"],
    ["347", "top-k-frequent-elements"],
    ["295", "find-median-from-data-stream"],
    ["121", "best-time-to-buy-and-sell-stock"],
    ["55", "jump-game"],
    ["45", "jump-game-ii"],
    ["763", "partition-labels"],
    ["70", "climbing-stairs"],
    ["118", "pascals-triangle"],
    ["198", "house-robber"],
    ["279", "perfect-squares"],
    ["322", "coin-change"],
    ["139", "word-break"],
    ["300", "longest-increasing-subsequence"],
    ["416", "partition-equal-subset-sum"],
    ["32", "longest-valid-parentheses"],
    ["62", "unique-paths"],
    ["64", "minimum-path-sum"],
    ["5", "longest-palindromic-substring"],
    ["1143", "longest-common-subsequence"],
    ["72", "edit-distance"],
    ["136", "single-number"],
    ["169", "majority-element"],
    ["75", "sort-colors"],
    ["31", "next-permutation"],
    ["287", "find-the-duplicate-number"]
]);

// 完整的 Hot 100 题目列表（按分类组织）
export const HOT_100_LIST: Hot100Question[] = [
    // 哈希 (Hash)
    { category: "哈希 (Hash)", frontendQuestionId: "1", titleSlug: "two-sum", titleEn: "Two Sum", titleCn: "两数之和" },
    { category: "哈希 (Hash)", frontendQuestionId: "49", titleSlug: "group-anagrams", titleEn: "Group Anagrams", titleCn: "字母异位词分组" },
    { category: "哈希 (Hash)", frontendQuestionId: "128", titleSlug: "longest-consecutive-sequence", titleEn: "Longest Consecutive Sequence", titleCn: "最长连续序列" },

    // 双指针 (Two Pointers)
    { category: "双指针 (Two Pointers)", frontendQuestionId: "283", titleSlug: "move-zeroes", titleEn: "Move Zeroes", titleCn: "移动零" },
    { category: "双指针 (Two Pointers)", frontendQuestionId: "11", titleSlug: "container-with-most-water", titleEn: "Container With Most Water", titleCn: "盛最多水的容器" },
    { category: "双指针 (Two Pointers)", frontendQuestionId: "15", titleSlug: "3sum", titleEn: "3Sum", titleCn: "三数之和" },
    { category: "双指针 (Two Pointers)", frontendQuestionId: "42", titleSlug: "trapping-rain-water", titleEn: "Trapping Rain Water", titleCn: "接雨水" },

    // 滑动窗口 (Sliding Window)
    { category: "滑动窗口 (Sliding Window)", frontendQuestionId: "3", titleSlug: "longest-substring-without-repeating-characters", titleEn: "Longest Substring Without Repeating Characters", titleCn: "无重复字符的最长子串" },
    { category: "滑动窗口 (Sliding Window)", frontendQuestionId: "438", titleSlug: "find-all-anagrams-in-a-string", titleEn: "Find All Anagrams in a String", titleCn: "找到字符串中所有字母异位词" },

    // 子串 (Substrings)
    { category: "子串 (Substrings)", frontendQuestionId: "560", titleSlug: "subarray-sum-equals-k", titleEn: "Subarray Sum Equals K", titleCn: "和为 K 的子数组" },
    { category: "子串 (Substrings)", frontendQuestionId: "239", titleSlug: "sliding-window-maximum", titleEn: "Sliding Window Maximum", titleCn: "滑动窗口最大值" },
    { category: "子串 (Substrings)", frontendQuestionId: "76", titleSlug: "minimum-window-substring", titleEn: "Minimum Window Substring", titleCn: "最小覆盖子串" },

    // 数组 (Array)
    { category: "数组 (Array)", frontendQuestionId: "53", titleSlug: "maximum-subarray", titleEn: "Maximum Subarray", titleCn: "最大子数组和" },
    { category: "数组 (Array)", frontendQuestionId: "56", titleSlug: "merge-intervals", titleEn: "Merge Intervals", titleCn: "合并区间" },
    { category: "数组 (Array)", frontendQuestionId: "189", titleSlug: "rotate-array", titleEn: "Rotate Array", titleCn: "轮转数组" },
    { category: "数组 (Array)", frontendQuestionId: "238", titleSlug: "product-of-array-except-self", titleEn: "Product of Array Except Self", titleCn: "除自身以外数组的乘积" },
    { category: "数组 (Array)", frontendQuestionId: "41", titleSlug: "first-missing-positive", titleEn: "First Missing Positive", titleCn: "缺失的第一个正数" },

    // 矩阵 (Matrix)
    { category: "矩阵 (Matrix)", frontendQuestionId: "73", titleSlug: "set-matrix-zeroes", titleEn: "Set Matrix Zeroes", titleCn: "矩阵置零" },
    { category: "矩阵 (Matrix)", frontendQuestionId: "54", titleSlug: "spiral-matrix", titleEn: "Spiral Matrix", titleCn: "螺旋矩阵" },
    { category: "矩阵 (Matrix)", frontendQuestionId: "48", titleSlug: "rotate-image", titleEn: "Rotate Image", titleCn: "旋转图像" },
    { category: "矩阵 (Matrix)", frontendQuestionId: "240", titleSlug: "search-a-2d-matrix-ii", titleEn: "Search a 2D Matrix II", titleCn: "搜索二维矩阵 II" },

    // 链表 (Linked List)
    { category: "链表 (Linked List)", frontendQuestionId: "160", titleSlug: "intersection-of-two-linked-lists", titleEn: "Intersection of Two Linked Lists", titleCn: "相交链表" },
    { category: "链表 (Linked List)", frontendQuestionId: "206", titleSlug: "reverse-linked-list", titleEn: "Reverse Linked List", titleCn: "反转链表" },
    { category: "链表 (Linked List)", frontendQuestionId: "234", titleSlug: "palindrome-linked-list", titleEn: "Palindrome Linked List", titleCn: "回文链表" },
    { category: "链表 (Linked List)", frontendQuestionId: "141", titleSlug: "linked-list-cycle", titleEn: "Linked List Cycle", titleCn: "环形链表" },
    { category: "链表 (Linked List)", frontendQuestionId: "142", titleSlug: "linked-list-cycle-ii", titleEn: "Linked List Cycle II", titleCn: "环形链表 II" },
    { category: "链表 (Linked List)", frontendQuestionId: "21", titleSlug: "merge-two-sorted-lists", titleEn: "Merge Two Sorted Lists", titleCn: "合并两个有序链表" },
    { category: "链表 (Linked List)", frontendQuestionId: "2", titleSlug: "add-two-numbers", titleEn: "Add Two Numbers", titleCn: "两数相加" },
    { category: "链表 (Linked List)", frontendQuestionId: "19", titleSlug: "remove-nth-node-from-end-of-list", titleEn: "Remove Nth Node From End of List", titleCn: "删除链表的倒数第 N 个结点" },
    { category: "链表 (Linked List)", frontendQuestionId: "24", titleSlug: "swap-nodes-in-pairs", titleEn: "Swap Nodes in Pairs", titleCn: "两两交换链表中的节点" },
    { category: "链表 (Linked List)", frontendQuestionId: "25", titleSlug: "reverse-nodes-in-k-group", titleEn: "Reverse Nodes in k-Group", titleCn: "K 个一组翻转链表" },
    { category: "链表 (Linked List)", frontendQuestionId: "138", titleSlug: "copy-list-with-random-pointer", titleEn: "Copy List with Random Pointer", titleCn: "随机链表的复制" },
    { category: "链表 (Linked List)", frontendQuestionId: "148", titleSlug: "sort-list", titleEn: "Sort List", titleCn: "排序链表" },
    { category: "链表 (Linked List)", frontendQuestionId: "23", titleSlug: "merge-k-sorted-lists", titleEn: "Merge k Sorted Lists", titleCn: "合并 K 个升序链表" },
    { category: "链表 (Linked List)", frontendQuestionId: "146", titleSlug: "lru-cache", titleEn: "LRU Cache", titleCn: "LRU 缓存" },

    // 二叉树 (Binary Tree)
    { category: "二叉树 (Binary Tree)", frontendQuestionId: "94", titleSlug: "binary-tree-inorder-traversal", titleEn: "Binary Tree Inorder Traversal", titleCn: "二叉树的中序遍历" },
    { category: "二叉树 (Binary Tree)", frontendQuestionId: "104", titleSlug: "maximum-depth-of-binary-tree", titleEn: "Maximum Depth of Binary Tree", titleCn: "二叉树的最大深度" },
    { category: "二叉树 (Binary Tree)", frontendQuestionId: "226", titleSlug: "invert-binary-tree", titleEn: "Invert Binary Tree", titleCn: "翻转二叉树" },
    { category: "二叉树 (Binary Tree)", frontendQuestionId: "101", titleSlug: "symmetric-tree", titleEn: "Symmetric Tree", titleCn: "对称二叉树" },
    { category: "二叉树 (Binary Tree)", frontendQuestionId: "543", titleSlug: "diameter-of-binary-tree", titleEn: "Diameter of Binary Tree", titleCn: "二叉树的直径" },
    { category: "二叉树 (Binary Tree)", frontendQuestionId: "102", titleSlug: "binary-tree-level-order-traversal", titleEn: "Binary Tree Level Order Traversal", titleCn: "二叉树的层序遍历" },
    { category: "二叉树 (Binary Tree)", frontendQuestionId: "108", titleSlug: "convert-sorted-array-to-binary-search-tree", titleEn: "Convert Sorted Array to Binary Search Tree", titleCn: "将有序数组转换为二叉搜索树" },
    { category: "二叉树 (Binary Tree)", frontendQuestionId: "98", titleSlug: "validate-binary-search-tree", titleEn: "Validate Binary Search Tree", titleCn: "验证二叉搜索树" },
    { category: "二叉树 (Binary Tree)", frontendQuestionId: "230", titleSlug: "kth-smallest-element-in-a-bst", titleEn: "Kth Smallest Element in a BST", titleCn: "二叉搜索树中第 K 小的元素" },
    { category: "二叉树 (Binary Tree)", frontendQuestionId: "199", titleSlug: "binary-tree-right-side-view", titleEn: "Binary Tree Right Side View", titleCn: "二叉树的右视图" },
    { category: "二叉树 (Binary Tree)", frontendQuestionId: "114", titleSlug: "flatten-binary-tree-to-linked-list", titleEn: "Flatten Binary Tree to Linked List", titleCn: "二叉树展开为链表" },
    { category: "二叉树 (Binary Tree)", frontendQuestionId: "105", titleSlug: "construct-binary-tree-from-preorder-and-inorder-traversal", titleEn: "Construct Binary Tree from Preorder and Inorder Traversal", titleCn: "从前序与中序遍历序列构造二叉树" },
    { category: "二叉树 (Binary Tree)", frontendQuestionId: "437", titleSlug: "path-sum-iii", titleEn: "Path Sum III", titleCn: "路径总和 III" },
    { category: "二叉树 (Binary Tree)", frontendQuestionId: "236", titleSlug: "lowest-common-ancestor-of-a-binary-tree", titleEn: "Lowest Common Ancestor of a Binary Tree", titleCn: "二叉树的最近公共祖先" },
    { category: "二叉树 (Binary Tree)", frontendQuestionId: "124", titleSlug: "binary-tree-maximum-path-sum", titleEn: "Binary Tree Maximum Path Sum", titleCn: "二叉树中的最大路径和" },

    // 图论 (Graph)
    { category: "图论 (Graph)", frontendQuestionId: "200", titleSlug: "number-of-islands", titleEn: "Number of Islands", titleCn: "岛屿数量" },
    { category: "图论 (Graph)", frontendQuestionId: "994", titleSlug: "rotting-oranges", titleEn: "Rotting Oranges", titleCn: "腐烂的橘子" },
    { category: "图论 (Graph)", frontendQuestionId: "207", titleSlug: "course-schedule", titleEn: "Course Schedule", titleCn: "课程表" },
    { category: "图论 (Graph)", frontendQuestionId: "208", titleSlug: "implement-trie-prefix-tree", titleEn: "Implement Trie (Prefix Tree)", titleCn: "实现 Trie (前缀树)" },

    // 回溯 (Backtracking)
    { category: "回溯 (Backtracking)", frontendQuestionId: "46", titleSlug: "permutations", titleEn: "Permutations", titleCn: "全排列" },
    { category: "回溯 (Backtracking)", frontendQuestionId: "78", titleSlug: "subsets", titleEn: "Subsets", titleCn: "子集" },
    { category: "回溯 (Backtracking)", frontendQuestionId: "17", titleSlug: "letter-combinations-of-a-phone-number", titleEn: "Letter Combinations of a Phone Number", titleCn: "电话号码的字母组合" },
    { category: "回溯 (Backtracking)", frontendQuestionId: "39", titleSlug: "combination-sum", titleEn: "Combination Sum", titleCn: "组合总和" },
    { category: "回溯 (Backtracking)", frontendQuestionId: "22", titleSlug: "generate-parentheses", titleEn: "Generate Parentheses", titleCn: "括号生成" },
    { category: "回溯 (Backtracking)", frontendQuestionId: "79", titleSlug: "word-search", titleEn: "Word Search", titleCn: "单词搜索" },
    { category: "回溯 (Backtracking)", frontendQuestionId: "131", titleSlug: "palindrome-partitioning", titleEn: "Palindrome Partitioning", titleCn: "分割回文串" },
    { category: "回溯 (Backtracking)", frontendQuestionId: "51", titleSlug: "n-queens", titleEn: "N-Queens", titleCn: "N 皇后" },

    // 二分查找 (Binary Search)
    { category: "二分查找 (Binary Search)", frontendQuestionId: "35", titleSlug: "search-insert-position", titleEn: "Search Insert Position", titleCn: "搜索插入位置" },
    { category: "二分查找 (Binary Search)", frontendQuestionId: "74", titleSlug: "search-a-2d-matrix", titleEn: "Search a 2D Matrix", titleCn: "搜索二维矩阵" },
    { category: "二分查找 (Binary Search)", frontendQuestionId: "34", titleSlug: "find-first-and-last-position-of-element-in-sorted-array", titleEn: "Find First and Last Position of Element in Sorted Array", titleCn: "在排序数组中查找元素的第一个和最后一个位置" },
    { category: "二分查找 (Binary Search)", frontendQuestionId: "33", titleSlug: "search-in-rotated-sorted-array", titleEn: "Search in Rotated Sorted Array", titleCn: "搜索旋转排序数组" },
    { category: "二分查找 (Binary Search)", frontendQuestionId: "153", titleSlug: "find-minimum-in-rotated-sorted-array", titleEn: "Find Minimum in Rotated Sorted Array", titleCn: "寻找旋转排序数组中的最小值" },
    { category: "二分查找 (Binary Search)", frontendQuestionId: "4", titleSlug: "median-of-two-sorted-arrays", titleEn: "Median of Two Sorted Arrays", titleCn: "寻找两个正序数组的中位数" },

    // 栈 (Stack)
    { category: "栈 (Stack)", frontendQuestionId: "20", titleSlug: "valid-parentheses", titleEn: "Valid Parentheses", titleCn: "有效的括号" },
    { category: "栈 (Stack)", frontendQuestionId: "155", titleSlug: "min-stack", titleEn: "Min Stack", titleCn: "最小栈" },
    { category: "栈 (Stack)", frontendQuestionId: "394", titleSlug: "decode-string", titleEn: "Decode String", titleCn: "字符串解码" },
    { category: "栈 (Stack)", frontendQuestionId: "739", titleSlug: "daily-temperatures", titleEn: "Daily Temperatures", titleCn: "每日温度" },
    { category: "栈 (Stack)", frontendQuestionId: "84", titleSlug: "largest-rectangle-in-histogram", titleEn: "Largest Rectangle in Histogram", titleCn: "柱状图中最大的矩形" },

    // 堆 (Heap)
    { category: "堆 (Heap)", frontendQuestionId: "215", titleSlug: "kth-largest-element-in-an-array", titleEn: "Kth Largest Element in an Array", titleCn: "数组中的第K个最大元素" },
    { category: "堆 (Heap)", frontendQuestionId: "347", titleSlug: "top-k-frequent-elements", titleEn: "Top K Frequent Elements", titleCn: "前 K 个高频元素" },
    { category: "堆 (Heap)", frontendQuestionId: "295", titleSlug: "find-median-from-data-stream", titleEn: "Find Median from Data Stream", titleCn: "数据流的中位数" },

    // 贪心 (Greedy)
    { category: "贪心 (Greedy)", frontendQuestionId: "121", titleSlug: "best-time-to-buy-and-sell-stock", titleEn: "Best Time to Buy and Sell Stock", titleCn: "买卖股票的最佳时机" },
    { category: "贪心 (Greedy)", frontendQuestionId: "55", titleSlug: "jump-game", titleEn: "Jump Game", titleCn: "跳跃游戏" },
    { category: "贪心 (Greedy)", frontendQuestionId: "45", titleSlug: "jump-game-ii", titleEn: "Jump Game II", titleCn: "跳跃游戏 II" },
    { category: "贪心 (Greedy)", frontendQuestionId: "763", titleSlug: "partition-labels", titleEn: "Partition Labels", titleCn: "划分字母区间" },

    // 动态规划 (Dynamic Programming)
    { category: "动态规划 (Dynamic Programming)", frontendQuestionId: "70", titleSlug: "climbing-stairs", titleEn: "Climbing Stairs", titleCn: "爬楼梯" },
    { category: "动态规划 (Dynamic Programming)", frontendQuestionId: "118", titleSlug: "pascals-triangle", titleEn: "Pascal's Triangle", titleCn: "杨辉三角" },
    { category: "动态规划 (Dynamic Programming)", frontendQuestionId: "198", titleSlug: "house-robber", titleEn: "House Robber", titleCn: "打家劫舍" },
    { category: "动态规划 (Dynamic Programming)", frontendQuestionId: "279", titleSlug: "perfect-squares", titleEn: "Perfect Squares", titleCn: "完全平方数" },
    { category: "动态规划 (Dynamic Programming)", frontendQuestionId: "322", titleSlug: "coin-change", titleEn: "Coin Change", titleCn: "零钱兑换" },
    { category: "动态规划 (Dynamic Programming)", frontendQuestionId: "139", titleSlug: "word-break", titleEn: "Word Break", titleCn: "单词拆分" },
    { category: "动态规划 (Dynamic Programming)", frontendQuestionId: "300", titleSlug: "longest-increasing-subsequence", titleEn: "Longest Increasing Subsequence", titleCn: "最长递增子序列" },
    { category: "动态规划 (Dynamic Programming)", frontendQuestionId: "416", titleSlug: "partition-equal-subset-sum", titleEn: "Partition Equal Subset Sum", titleCn: "分割等和子集" },
    { category: "动态规划 (Dynamic Programming)", frontendQuestionId: "32", titleSlug: "longest-valid-parentheses", titleEn: "Longest Valid Parentheses", titleCn: "最长有效括号" },

    // 多维动态规划 (Multi-dimensional DP)
    { category: "多维动态规划 (Multi-dimensional DP)", frontendQuestionId: "62", titleSlug: "unique-paths", titleEn: "Unique Paths", titleCn: "不同路径" },
    { category: "多维动态规划 (Multi-dimensional DP)", frontendQuestionId: "64", titleSlug: "minimum-path-sum", titleEn: "Minimum Path Sum", titleCn: "最小路径和" },
    { category: "多维动态规划 (Multi-dimensional DP)", frontendQuestionId: "5", titleSlug: "longest-palindromic-substring", titleEn: "Longest Palindromic Substring", titleCn: "最长回文子串" },
    { category: "多维动态规划 (Multi-dimensional DP)", frontendQuestionId: "1143", titleSlug: "longest-common-subsequence", titleEn: "Longest Common Subsequence", titleCn: "最长公共子序列" },
    { category: "多维动态规划 (Multi-dimensional DP)", frontendQuestionId: "72", titleSlug: "edit-distance", titleEn: "Edit Distance", titleCn: "编辑距离" },

    // 技巧 (Bit Manipulation / Math)
    { category: "技巧 (Bit Manipulation / Math)", frontendQuestionId: "136", titleSlug: "single-number", titleEn: "Single Number", titleCn: "只出现一次的数字" },
    { category: "技巧 (Bit Manipulation / Math)", frontendQuestionId: "169", titleSlug: "majority-element", titleEn: "Majority Element", titleCn: "多数元素" },
    { category: "技巧 (Bit Manipulation / Math)", frontendQuestionId: "75", titleSlug: "sort-colors", titleEn: "Sort Colors", titleCn: "颜色分类" },
    { category: "技巧 (Bit Manipulation / Math)", frontendQuestionId: "31", titleSlug: "next-permutation", titleEn: "Next Permutation", titleCn: "下一个排列" },
    { category: "技巧 (Bit Manipulation / Math)", frontendQuestionId: "287", titleSlug: "find-the-duplicate-number", titleEn: "Find the Duplicate Number", titleCn: "寻找重复数" },
];

/**
 * 按分类获取题目
 */
export function getQuestionsByCategory(): Map<string, Hot100Question[]> {
    const categoryMap = new Map<string, Hot100Question[]>();

    for (const category of CATEGORIES) {
        categoryMap.set(category, []);
    }

    for (const question of HOT_100_LIST) {
        const questions = categoryMap.get(question.category);
        if (questions) {
            questions.push(question);
        }
    }

    return categoryMap;
}

/**
 * 检查题目是否属于 Hot 100
 */
export function isHot100(frontendQuestionId: string): boolean {
    return HOT_100_IDS.has(frontendQuestionId);
}

/**
 * 获取题目的分类信息
 */
export function getQuestionCategory(frontendQuestionId: string): string | undefined {
    const question = HOT_100_LIST.find(q => q.frontendQuestionId === frontendQuestionId);
    return question?.category;
}

/**
 * 根据题目ID获取titleSlug
 */
export function getTitleSlug(frontendQuestionId: string): string | undefined {
    return ID_TO_SLUG.get(frontendQuestionId);
}
