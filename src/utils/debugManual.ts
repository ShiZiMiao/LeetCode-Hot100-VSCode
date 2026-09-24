/**
 * Java / C++ / Go / Rust 本地调试模板（纯函数，无 vscode 依赖）。
 * 这些语言的模板是自包含手动骨架（main 中 TODO 手动构造用例），生成后由用户补充测试代码；
 * 特殊判题题（设计类/自定义校验）不实例化带参入口类，仅编译用。
 */

/**
 * 入口类名：常规题为 class Solution；设计类题为自建容器类（MyHashMap 等），
 * 取去掉注释后第一个类声明（特殊题不实例化，仅编译用）。
 */
function entryClassOf(codeSnippet: string): string {
    const cleaned = codeSnippet.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    if (/\bclass\s+Solution\b/.test(cleaned)) {
        return 'Solution';
    }
    const m = cleaned.match(/(?:class|struct)\s+(\w+)/);
    return m ? m[1] : 'Solution';
}

/**
 * Java 生成文件的类名（PascalCase(titleSlug) + Debug）。
 * 文件名与 public 类名必须一致（Java 编译要求），模板与打包名共用本函数防漂移。
 */
export function javaClassNameOf(titleSlug: string): string {
    return titleSlug.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('') + 'Debug';
}

export function javaDebugDriver(questionId: string, titleSlug: string, _testCases: string, codeSnippet: string, isSpecial: boolean): string {
    // 提取方法名（返回类型兼容泛型与 [] 后缀，如 int[] twoSum(）
    const funcMatch = codeSnippet.match(/public\s+[\w$]+(?:<[^>]+>)?(?:\[\])*\s+(\w+)\s*\(/);
    const funcName = funcMatch ? funcMatch[1] : 'solution';
    // 入口类名（常规题 class Solution；设计类题不实例化，注释引导）
    const entryClass = entryClassOf(codeSnippet);
    const className = javaClassNameOf(titleSlug);

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
        ${isSpecial
            ? '// 特殊判题题（设计类/自定义校验）：入口类构造可能带参数，请按题目手动实例化（见下方 TODO）'
            : `${entryClass} solution = new ${entryClass}();`}

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

export function cppDebugDriver(questionId: string, titleSlug: string, _testCases: string, codeSnippet: string, isSpecial: boolean): string {
    // 提取函数名（兼容 * 紧贴函数名的返回类型写法，如 int* twoSum(）
    const funcMatch = codeSnippet.match(/(?:^|[\s*])(\w+)\s*\([^)]*\)\s*{/);
    const funcName = funcMatch ? funcMatch[1] : 'solution';
    // 入口类名（常规题 class Solution；设计类题不实例化，注释引导）
    const entryClass = entryClassOf(codeSnippet);

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
    ${isSpecial
        ? '// 特殊判题题（设计类/自定义校验）：入口类构造可能带参数，请按题目手动实例化（见下方 TODO）'
        : `${entryClass} solution;`}

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

export function goDebugDriver(questionId: string, titleSlug: string, _testCases: string, codeSnippet: string): string {
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

export function rustDebugDriver(questionId: string, titleSlug: string, _testCases: string, codeSnippet: string): string {
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
