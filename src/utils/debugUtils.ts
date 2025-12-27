/**
 * 调试工具
 * 为不同语言生成本地调试代码
 */

/**
 * 生成Python调试模板
 */
export function generatePythonDebugTemplate(
    questionId: string,
    titleSlug: string,
    testCases: string,
    codeSnippet: string
): string {
    // 提取函数名
    const funcMatch = codeSnippet.match(/def\s+(\w+)\s*\(/);
    const funcName = funcMatch ? funcMatch[1] : 'solution';

    return `# ============================================
# LeetCode ${questionId}. ${titleSlug} - 本地调试文件
# 运行方式: python ${questionId}_${titleSlug}_debug.py
# ============================================

from typing import List, Optional
from collections import deque, defaultdict
import heapq
import json

# ============================================
# 常用数据结构定义
# ============================================

class ListNode:
    """链表节点"""
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next
    
    @staticmethod
    def from_list(arr):
        if not arr:
            return None
        head = ListNode(arr[0])
        curr = head
        for val in arr[1:]:
            curr.next = ListNode(val)
            curr = curr.next
        return head
    
    def to_list(self):
        result = []
        curr = self
        while curr:
            result.append(curr.val)
            curr = curr.next
        return result

class TreeNode:
    """二叉树节点"""
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right
    
    @staticmethod
    def from_list(arr):
        if not arr or arr[0] is None:
            return None
        root = TreeNode(arr[0])
        queue = deque([root])
        i = 1
        while queue and i < len(arr):
            node = queue.popleft()
            if i < len(arr) and arr[i] is not None:
                node.left = TreeNode(arr[i])
                queue.append(node.left)
            i += 1
            if i < len(arr) and arr[i] is not None:
                node.right = TreeNode(arr[i])
                queue.append(node.right)
            i += 1
        return root

# ============================================
# 你的解题代码
# ============================================

${codeSnippet}

# ============================================
# 测试运行
# ============================================

if __name__ == "__main__":
    solution = Solution()
    
    # LeetCode 测试用例
    test_cases = """${testCases}"""
    
    print("=" * 50)
    print("开始本地调试")
    print("=" * 50)
    
    lines = [line.strip() for line in test_cases.strip().split('\\n') if line.strip()]
    
    if len(lines) >= 1:
        try:
            param1 = json.loads(lines[0])
            param2 = json.loads(lines[1]) if len(lines) > 1 else None
            
            print(f"输入参数1: {param1}")
            if param2 is not None:
                print(f"输入参数2: {param2}")
            
            # 调用解法 (根据题目修改参数)
            if param2 is not None:
                result = solution.${funcName}(param1, param2)
            else:
                result = solution.${funcName}(param1)
            
            print(f"输出结果: {result}")
            
        except Exception as e:
            print(f"运行出错: {e}")
            import traceback
            traceback.print_exc()
    
    # ============================================
    # 自定义测试用例
    # ============================================
    # result = solution.${funcName}([2, 7, 11, 15], 9)
    # print(f"自定义测试: {result}")
`;
}

/**
 * 生成Java调试模板
 */
export function generateJavaDebugTemplate(
    questionId: string,
    titleSlug: string,
    testCases: string,
    codeSnippet: string
): string {
    // 提取方法名
    const funcMatch = codeSnippet.match(/public\s+\w+(?:<[^>]+>)?\s+(\w+)\s*\(/);
    const funcName = funcMatch ? funcMatch[1] : 'solution';

    // 生成类名
    const className = titleSlug.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('') + 'Debug';

    return `// ============================================
// LeetCode ${questionId}. ${titleSlug} - 本地调试文件
// 编译: javac ${className}.java
// 运行: java ${className}
// ============================================

import java.util.*;

// ============================================
// 常用数据结构定义
// ============================================

class ListNode {
    int val;
    ListNode next;
    ListNode() {}
    ListNode(int val) { this.val = val; }
    ListNode(int val, ListNode next) { this.val = val; this.next = next; }
    
    static ListNode fromArray(int[] arr) {
        if (arr == null || arr.length == 0) return null;
        ListNode head = new ListNode(arr[0]);
        ListNode curr = head;
        for (int i = 1; i < arr.length; i++) {
            curr.next = new ListNode(arr[i]);
            curr = curr.next;
        }
        return head;
    }
    
    @Override
    public String toString() {
        StringBuilder sb = new StringBuilder("[");
        ListNode curr = this;
        while (curr != null) {
            sb.append(curr.val);
            if (curr.next != null) sb.append(", ");
            curr = curr.next;
        }
        sb.append("]");
        return sb.toString();
    }
}

class TreeNode {
    int val;
    TreeNode left;
    TreeNode right;
    TreeNode() {}
    TreeNode(int val) { this.val = val; }
    TreeNode(int val, TreeNode left, TreeNode right) {
        this.val = val;
        this.left = left;
        this.right = right;
    }
    
    static TreeNode fromArray(Integer[] arr) {
        if (arr == null || arr.length == 0 || arr[0] == null) return null;
        TreeNode root = new TreeNode(arr[0]);
        Queue<TreeNode> queue = new LinkedList<>();
        queue.offer(root);
        int i = 1;
        while (!queue.isEmpty() && i < arr.length) {
            TreeNode node = queue.poll();
            if (i < arr.length && arr[i] != null) {
                node.left = new TreeNode(arr[i]);
                queue.offer(node.left);
            }
            i++;
            if (i < arr.length && arr[i] != null) {
                node.right = new TreeNode(arr[i]);
                queue.offer(node.right);
            }
            i++;
        }
        return root;
    }
}

// ============================================
// 你的解题代码
// ============================================

${codeSnippet}

// ============================================
// 测试运行
// ============================================

public class ${className} {
    public static void main(String[] args) {
        Solution solution = new Solution();
        
        System.out.println("==================================================");
        System.out.println("开始本地调试");
        System.out.println("==================================================");
        
        // TODO: 根据题目修改测试参数
        // 示例: 两数之和
        // int[] nums = {2, 7, 11, 15};
        // int target = 9;
        // int[] result = solution.${funcName}(nums, target);
        // System.out.println("结果: " + Arrays.toString(result));
        
        // ============================================
        // 在这里添加你的测试代码
        // ============================================
        
    }
}
`;
}

/**
 * 生成C++调试模板
 */
export function generateCppDebugTemplate(
    questionId: string,
    titleSlug: string,
    testCases: string,
    codeSnippet: string
): string {
    // 提取函数名
    const funcMatch = codeSnippet.match(/\s+(\w+)\s*\([^)]*\)\s*{/);
    const funcName = funcMatch ? funcMatch[1] : 'solution';

    return `// ============================================
// LeetCode ${questionId}. ${titleSlug} - 本地调试文件
// 编译: g++ -std=c++17 -o debug ${questionId}_${titleSlug}_debug.cpp
// 运行: ./debug
// ============================================

#include <iostream>
#include <vector>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <queue>
#include <stack>
#include <algorithm>
using namespace std;

// ============================================
// 常用数据结构定义
// ============================================

struct ListNode {
    int val;
    ListNode *next;
    ListNode() : val(0), next(nullptr) {}
    ListNode(int x) : val(x), next(nullptr) {}
    ListNode(int x, ListNode *next) : val(x), next(next) {}
    
    static ListNode* fromVector(vector<int>& arr) {
        if (arr.empty()) return nullptr;
        ListNode* head = new ListNode(arr[0]);
        ListNode* curr = head;
        for (int i = 1; i < arr.size(); i++) {
            curr->next = new ListNode(arr[i]);
            curr = curr->next;
        }
        return head;
    }
    
    void print() {
        cout << "[";
        ListNode* curr = this;
        while (curr) {
            cout << curr->val;
            if (curr->next) cout << ", ";
            curr = curr->next;
        }
        cout << "]" << endl;
    }
};

struct TreeNode {
    int val;
    TreeNode *left;
    TreeNode *right;
    TreeNode() : val(0), left(nullptr), right(nullptr) {}
    TreeNode(int x) : val(x), left(nullptr), right(nullptr) {}
    TreeNode(int x, TreeNode *left, TreeNode *right) : val(x), left(left), right(right) {}
};

// 打印vector
template<typename T>
void printVector(vector<T>& v) {
    cout << "[";
    for (int i = 0; i < v.size(); i++) {
        cout << v[i];
        if (i < v.size() - 1) cout << ", ";
    }
    cout << "]" << endl;
}

// ============================================
// 你的解题代码
// ============================================

${codeSnippet}

// ============================================
// 测试运行
// ============================================

int main() {
    Solution solution;
    
    cout << "==================================================" << endl;
    cout << "开始本地调试" << endl;
    cout << "==================================================" << endl;
    
    // TODO: 根据题目修改测试参数
    // 示例: 两数之和
    // vector<int> nums = {2, 7, 11, 15};
    // int target = 9;
    // vector<int> result = solution.${funcName}(nums, target);
    // printVector(result);
    
    // ============================================
    // 在这里添加你的测试代码
    // ============================================
    
    return 0;
}
`;
}

/**
 * 生成JavaScript调试模板
 */
export function generateJavaScriptDebugTemplate(
    questionId: string,
    titleSlug: string,
    testCases: string,
    codeSnippet: string
): string {
    // 提取函数名
    const funcMatch = codeSnippet.match(/var\s+(\w+)\s*=\s*function/) ||
        codeSnippet.match(/function\s+(\w+)\s*\(/);
    const funcName = funcMatch ? funcMatch[1] : 'solution';

    return `// ============================================
// LeetCode ${questionId}. ${titleSlug} - 本地调试文件
// 运行方式: node ${questionId}_${titleSlug}_debug.js
// ============================================

// ============================================
// 常用数据结构定义
// ============================================

class ListNode {
    constructor(val = 0, next = null) {
        this.val = val;
        this.next = next;
    }
    
    static fromArray(arr) {
        if (!arr || arr.length === 0) return null;
        const head = new ListNode(arr[0]);
        let curr = head;
        for (let i = 1; i < arr.length; i++) {
            curr.next = new ListNode(arr[i]);
            curr = curr.next;
        }
        return head;
    }
    
    toArray() {
        const result = [];
        let curr = this;
        while (curr) {
            result.push(curr.val);
            curr = curr.next;
        }
        return result;
    }
}

class TreeNode {
    constructor(val = 0, left = null, right = null) {
        this.val = val;
        this.left = left;
        this.right = right;
    }
    
    static fromArray(arr) {
        if (!arr || arr.length === 0 || arr[0] === null) return null;
        const root = new TreeNode(arr[0]);
        const queue = [root];
        let i = 1;
        while (queue.length > 0 && i < arr.length) {
            const node = queue.shift();
            if (i < arr.length && arr[i] !== null) {
                node.left = new TreeNode(arr[i]);
                queue.push(node.left);
            }
            i++;
            if (i < arr.length && arr[i] !== null) {
                node.right = new TreeNode(arr[i]);
                queue.push(node.right);
            }
            i++;
        }
        return root;
    }
}

// ============================================
// 你的解题代码
// ============================================

${codeSnippet}

// ============================================
// 测试运行
// ============================================

console.log("==================================================");
console.log("开始本地调试");
console.log("==================================================");

// LeetCode 测试用例
const testCases = \`${testCases}\`;

const lines = testCases.trim().split('\\n').filter(line => line.trim());

if (lines.length >= 1) {
    try {
        const param1 = JSON.parse(lines[0]);
        const param2 = lines.length > 1 ? JSON.parse(lines[1]) : undefined;
        
        console.log("输入参数1:", param1);
        if (param2 !== undefined) {
            console.log("输入参数2:", param2);
        }
        
        // 调用解法
        const result = param2 !== undefined 
            ? ${funcName}(param1, param2)
            : ${funcName}(param1);
        
        console.log("输出结果:", result);
        
    } catch (e) {
        console.error("运行出错:", e);
    }
}

// ============================================
// 自定义测试用例
// ============================================
// const result = ${funcName}([2, 7, 11, 15], 9);
// console.log("自定义测试:", result);
`;
}

/**
 * 生成TypeScript调试模板
 */
export function generateTypeScriptDebugTemplate(
    questionId: string,
    titleSlug: string,
    testCases: string,
    codeSnippet: string
): string {
    // 提取函数名
    const funcMatch = codeSnippet.match(/function\s+(\w+)\s*\(/);
    const funcName = funcMatch ? funcMatch[1] : 'solution';

    return `// ============================================
// LeetCode ${questionId}. ${titleSlug} - 本地调试文件
// 运行方式: npx ts-node ${questionId}_${titleSlug}_debug.ts
// ============================================

// ============================================
// 常用数据结构定义
// ============================================

class ListNode {
    val: number;
    next: ListNode | null;
    constructor(val: number = 0, next: ListNode | null = null) {
        this.val = val;
        this.next = next;
    }
    
    static fromArray(arr: number[]): ListNode | null {
        if (!arr || arr.length === 0) return null;
        const head = new ListNode(arr[0]);
        let curr = head;
        for (let i = 1; i < arr.length; i++) {
            curr.next = new ListNode(arr[i]);
            curr = curr.next;
        }
        return head;
    }
    
    toArray(): number[] {
        const result: number[] = [];
        let curr: ListNode | null = this;
        while (curr) {
            result.push(curr.val);
            curr = curr.next;
        }
        return result;
    }
}

class TreeNode {
    val: number;
    left: TreeNode | null;
    right: TreeNode | null;
    constructor(val: number = 0, left: TreeNode | null = null, right: TreeNode | null = null) {
        this.val = val;
        this.left = left;
        this.right = right;
    }
    
    static fromArray(arr: (number | null)[]): TreeNode | null {
        if (!arr || arr.length === 0 || arr[0] === null) return null;
        const root = new TreeNode(arr[0]);
        const queue: TreeNode[] = [root];
        let i = 1;
        while (queue.length > 0 && i < arr.length) {
            const node = queue.shift()!;
            if (i < arr.length && arr[i] !== null) {
                node.left = new TreeNode(arr[i] as number);
                queue.push(node.left);
            }
            i++;
            if (i < arr.length && arr[i] !== null) {
                node.right = new TreeNode(arr[i] as number);
                queue.push(node.right);
            }
            i++;
        }
        return root;
    }
}

// ============================================
// 你的解题代码
// ============================================

${codeSnippet}

// ============================================
// 测试运行
// ============================================

console.log("==================================================");
console.log("开始本地调试");
console.log("==================================================");

// LeetCode 测试用例
const testCases = \`${testCases}\`;

const lines = testCases.trim().split('\\n').filter(line => line.trim());

if (lines.length >= 1) {
    try {
        const param1 = JSON.parse(lines[0]);
        const param2 = lines.length > 1 ? JSON.parse(lines[1]) : undefined;
        
        console.log("输入参数1:", param1);
        if (param2 !== undefined) {
            console.log("输入参数2:", param2);
        }
        
        // 调用解法
        const result = param2 !== undefined 
            ? ${funcName}(param1, param2)
            : ${funcName}(param1);
        
        console.log("输出结果:", result);
        
    } catch (e) {
        console.error("运行出错:", e);
    }
}

// ============================================
// 自定义测试用例
// ============================================
// const result = ${funcName}([2, 7, 11, 15], 9);
// console.log("自定义测试:", result);
`;
}

/**
 * 生成Go调试模板
 */
export function generateGoDebugTemplate(
    questionId: string,
    titleSlug: string,
    testCases: string,
    codeSnippet: string
): string {
    // 提取函数名
    const funcMatch = codeSnippet.match(/func\s+(\w+)\s*\(/);
    const funcName = funcMatch ? funcMatch[1] : 'solution';

    return `// ============================================
// LeetCode ${questionId}. ${titleSlug} - 本地调试文件
// 运行方式: go run ${questionId}_${titleSlug}_debug.go
// ============================================

package main

import (
    "fmt"
)

// ============================================
// 常用数据结构定义
// ============================================

type ListNode struct {
    Val  int
    Next *ListNode
}

func NewListNode(arr []int) *ListNode {
    if len(arr) == 0 {
        return nil
    }
    head := &ListNode{Val: arr[0]}
    curr := head
    for i := 1; i < len(arr); i++ {
        curr.Next = &ListNode{Val: arr[i]}
        curr = curr.Next
    }
    return head
}

func (l *ListNode) ToSlice() []int {
    result := []int{}
    curr := l
    for curr != nil {
        result = append(result, curr.Val)
        curr = curr.Next
    }
    return result
}

type TreeNode struct {
    Val   int
    Left  *TreeNode
    Right *TreeNode
}

// ============================================
// 你的解题代码
// ============================================

${codeSnippet}

// ============================================
// 测试运行
// ============================================

func main() {
    fmt.Println("==================================================")
    fmt.Println("开始本地调试")
    fmt.Println("==================================================")
    
    // TODO: 根据题目修改测试参数
    // 示例: 两数之和
    // nums := []int{2, 7, 11, 15}
    // target := 9
    // result := ${funcName}(nums, target)
    // fmt.Println("结果:", result)
    
    // ============================================
    // 在这里添加你的测试代码
    // ============================================
    
}
`;
}

/**
 * 生成Rust调试模板
 */
export function generateRustDebugTemplate(
    questionId: string,
    titleSlug: string,
    testCases: string,
    codeSnippet: string
): string {
    // 提取函数名
    const funcMatch = codeSnippet.match(/pub\s+fn\s+(\w+)\s*\(/);
    const funcName = funcMatch ? funcMatch[1] : 'solution';

    return `// ============================================
// LeetCode ${questionId}. ${titleSlug} - 本地调试文件
// 运行方式: rustc ${questionId}_${titleSlug}_debug.rs && ./${questionId}_${titleSlug}_debug
// 或者: cargo run
// ============================================

use std::collections::{HashMap, HashSet, VecDeque};

// ============================================
// 常用数据结构定义
// ============================================

#[derive(PartialEq, Eq, Clone, Debug)]
pub struct ListNode {
    pub val: i32,
    pub next: Option<Box<ListNode>>,
}

impl ListNode {
    #[inline]
    fn new(val: i32) -> Self {
        ListNode { next: None, val }
    }
    
    fn from_vec(arr: Vec<i32>) -> Option<Box<ListNode>> {
        let mut head: Option<Box<ListNode>> = None;
        for &val in arr.iter().rev() {
            let mut node = ListNode::new(val);
            node.next = head;
            head = Some(Box::new(node));
        }
        head
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct TreeNode {
    pub val: i32,
    pub left: Option<Rc<RefCell<TreeNode>>>,
    pub right: Option<Rc<RefCell<TreeNode>>>,
}

use std::rc::Rc;
use std::cell::RefCell;

impl TreeNode {
    #[inline]
    pub fn new(val: i32) -> Self {
        TreeNode {
            val,
            left: None,
            right: None,
        }
    }
}

// ============================================
// 你的解题代码
// ============================================

struct Solution;

${codeSnippet}

// ============================================
// 测试运行
// ============================================

fn main() {
    println!("==================================================");
    println!("开始本地调试");
    println!("==================================================");
    
    // TODO: 根据题目修改测试参数
    // 示例: 两数之和
    // let nums = vec![2, 7, 11, 15];
    // let target = 9;
    // let result = Solution::${funcName}(nums, target);
    // println!("结果: {:?}", result);
    
    // ============================================
    // 在这里添加你的测试代码
    // ============================================
    
}
`;
}

/**
 * 生成调试文件的内容
 */
export function generateDebugFile(
    lang: string,
    questionId: string,
    titleSlug: string,
    testCases: string,
    codeSnippet: string
): { fileName: string; content: string } | null {
    switch (lang) {
        case 'python3':
        case 'python':
            return {
                fileName: `${questionId}_${titleSlug}_debug.py`,
                content: generatePythonDebugTemplate(questionId, titleSlug, testCases, codeSnippet)
            };

        case 'java':
            const javaClassName = titleSlug.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('') + 'Debug';
            return {
                fileName: `${javaClassName}.java`,
                content: generateJavaDebugTemplate(questionId, titleSlug, testCases, codeSnippet)
            };

        case 'cpp':
        case 'c++':
            return {
                fileName: `${questionId}_${titleSlug}_debug.cpp`,
                content: generateCppDebugTemplate(questionId, titleSlug, testCases, codeSnippet)
            };

        case 'javascript':
            return {
                fileName: `${questionId}_${titleSlug}_debug.js`,
                content: generateJavaScriptDebugTemplate(questionId, titleSlug, testCases, codeSnippet)
            };

        case 'typescript':
            return {
                fileName: `${questionId}_${titleSlug}_debug.ts`,
                content: generateTypeScriptDebugTemplate(questionId, titleSlug, testCases, codeSnippet)
            };

        case 'golang':
        case 'go':
            return {
                fileName: `${questionId}_${titleSlug}_debug.go`,
                content: generateGoDebugTemplate(questionId, titleSlug, testCases, codeSnippet)
            };

        case 'rust':
            return {
                fileName: `${questionId}_${titleSlug}_debug.rs`,
                content: generateRustDebugTemplate(questionId, titleSlug, testCases, codeSnippet)
            };

        default:
            return null;
    }
}
