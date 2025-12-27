/**
 * 题解Webview渲染工具
 * 处理Markdown解析、LaTeX公式、多语言代码块标签页
 */

/**
 * 生成题解Webview的HTML模板
 */
export function generateSolutionWebviewHtml(title: string, content: string): string {
    return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    ${getStylesheet()}
    ${getExternalLibraries()}
</head>
<body>
    <div class="solution-container">
        <h1>${title}</h1>
        <div class="solution-content" id="solution-content"></div>
    </div>
    ${getRenderScript(content)}
</body>
</html>
    `;
}

/**
 * 获取样式表
 */
function getStylesheet(): string {
    return `
<style>
    body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        padding: 20px;
        line-height: 1.6;
        color: var(--vscode-foreground);
        background-color: var(--vscode-editor-background);
    }
    h1 { color: var(--vscode-textLink-foreground); font-size: 1.5em; }
    h2 { color: var(--vscode-textLink-foreground); margin-top: 24px; }
    
    /* 代码块样式 */
    pre {
        background: var(--vscode-textPreformat-background);
        padding: 16px;
        border-radius: 6px;
        overflow-x: auto;
        margin: 16px 0;
    }
    pre code {
        font-family: 'Fira Code', Consolas, 'Courier New', monospace;
        font-size: 14px;
        line-height: 1.5;
    }
    
    /* 图片样式 */
    img { max-width: 100%; border-radius: 8px; margin: 16px 0; }
    
    /* 引用块样式 */
    blockquote {
        border-left: 4px solid var(--vscode-textLink-foreground);
        margin: 16px 0;
        padding: 8px 16px;
        background: var(--vscode-textBlockQuote-background);
    }
    
    /* 链接样式 */
    a { color: var(--vscode-textLink-foreground); }
    
    /* 语言标签页样式 */
    .lang-tabs {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-top: 16px;
        margin-bottom: 0;
    }
    .lang-tab {
        padding: 8px 16px;
        background: var(--vscode-tab-inactiveBackground);
        border: 1px solid var(--vscode-panel-border);
        border-bottom: none;
        border-radius: 6px 6px 0 0;
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        color: var(--vscode-foreground);
        transition: all 0.2s;
    }
    .lang-tab:hover {
        background: var(--vscode-tab-hoverBackground);
    }
    .lang-tab.active {
        background: var(--vscode-textPreformat-background);
        border-bottom: 1px solid var(--vscode-textPreformat-background);
        color: var(--vscode-textLink-foreground);
    }
    .lang-code-block {
        display: none;
        margin-top: -1px;
    }
    .lang-code-block.active {
        display: block;
    }
    .lang-code-block pre {
        margin-top: 0;
        border-radius: 0 6px 6px 6px;
    }
    
    /* KaTeX公式样式 */
    .katex { font-size: 1.1em; }
    
    /* 返回按钮 */
    .back-btn {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        padding: 8px 16px;
        border-radius: 4px;
        cursor: pointer;
        margin-bottom: 20px;
    }
    .back-btn:hover {
        background: var(--vscode-button-hoverBackground);
    }
</style>
    `;
}

/**
 * 获取外部库CDN
 */
function getExternalLibraries(): string {
    return `
<!-- Marked - Markdown解析 -->
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<!-- KaTeX - LaTeX公式渲染 -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"></script>
    `;
}

/**
 * 获取渲染脚本
 */
function getRenderScript(content: string): string {
    const escapedContent = JSON.stringify(content);
    return `
<script>
(function() {
    const md = ${escapedContent};
    const el = document.getElementById('solution-content');
    
    if (typeof marked !== 'undefined') {
        // 配置marked
        const renderer = new marked.Renderer();
        renderer.code = function(code, lang) {
            const cleanLang = lang ? lang.replace(/\\s*\\[.*\\]$/, '').trim() : '';
            const langClass = cleanLang ? 'language-' + cleanLang : '';
            const codeText = code.text || code;
            return '<pre data-lang="' + cleanLang + '"><code class="' + langClass + '">' + 
                codeText.replace(/</g, '&lt;').replace(/>/g, '&gt;') + 
                '</code></pre>';
        };
        marked.setOptions({ renderer: renderer, breaks: true, gfm: true });
        el.innerHTML = marked.parse(md);
        
        // 渲染LaTeX公式（行内）
        if (typeof renderMathInElement !== 'undefined') {
            renderMathInElement(el, {
                delimiters: [
                    {left: '$$', right: '$$', display: false},
                    {left: '$', right: '$', display: false}
                ],
                throwOnError: false
            });
        }
        
        // 处理多语言代码块
        processCodeTabs(el);
    } else {
        el.innerHTML = md.replace(/\\n/g, '<br>');
    }
})();

// 多语言代码块标签页处理
function processCodeTabs(container) {
    const pres = Array.from(container.querySelectorAll('pre[data-lang]'));
    if (pres.length < 2) return;
    
    // 按连续性分组
    let groups = [];
    let current = [];
    
    for (let i = 0; i < pres.length; i++) {
        const pre = pres[i];
        const lang = pre.getAttribute('data-lang');
        
        if (lang) {
            current.push({pre, lang});
            
            // 检查下一个是否相邻（允许一个空白节点间隔）
            const next = pres[i + 1];
            let isAdjacent = false;
            if (next) {
                let sibling = pre.nextElementSibling;
                for (let j = 0; j < 3 && sibling; j++) {
                    if (sibling === next) { isAdjacent = true; break; }
                    sibling = sibling.nextElementSibling;
                }
            }
            
            if (!next || !isAdjacent) {
                if (current.length > 1) {
                    groups.push([...current]);
                }
                current = [];
            }
        } else {
            if (current.length > 1) groups.push([...current]);
            current = [];
        }
    }
    if (current.length > 1) groups.push([...current]);
    
    // 为每组创建标签页
    groups.forEach(group => {
        const wrapper = document.createElement('div');
        wrapper.className = 'code-tabs-container';
        
        const tabs = document.createElement('div');
        tabs.className = 'lang-tabs';
        
        const contents = document.createElement('div');
        contents.className = 'lang-contents';
        
        group.forEach((item, idx) => {
            // 创建标签按钮
            const tab = document.createElement('button');
            tab.className = 'lang-tab' + (idx === 0 ? ' active' : '');
            tab.textContent = item.lang.charAt(0).toUpperCase() + item.lang.slice(1);
            tab.onclick = function() {
                tabs.querySelectorAll('.lang-tab').forEach(t => t.classList.remove('active'));
                contents.querySelectorAll('.lang-code-block').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                contents.children[idx].classList.add('active');
            };
            tabs.appendChild(tab);
            
            // 创建代码内容
            const content = document.createElement('div');
            content.className = 'lang-code-block' + (idx === 0 ? ' active' : '');
            content.appendChild(item.pre.cloneNode(true));
            contents.appendChild(content);
        });
        
        wrapper.appendChild(tabs);
        wrapper.appendChild(contents);
        
        // 插入wrapper并移除原代码块
        group[0].pre.parentNode.insertBefore(wrapper, group[0].pre);
        group.forEach(item => item.pre.remove());
    });
}
</script>
    `;
}
