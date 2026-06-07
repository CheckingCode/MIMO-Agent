# -*- coding: utf-8 -*-
with open('README.md', 'r', encoding='utf-8') as f:
    content = f.read()

idx = content.find('### v1.5.2')
if idx < 0:
    print("ERROR: v1.5.2 not found")
    exit(1)

new_entry = (
    '### v1.5.4\n'
    '- \u2728 \u65b0\u589e\u56de\u5408\u53d9\u8ff0\u7cfb\u7edf\uff1a\u6bcf\u8f6e\u5f00\u59cb\u65f6\u5c55\u793a\u4efb\u52a1\u590d\u6742\u5ea6\u3001\u8f6e\u6b21\u9884\u7b97\u3001\u505c\u6ede\u72b6\u6001\u4e0e\u6a21\u5f0f\u63d0\u793a / Added round narration system showing task complexity, budget, stall status, and mode hints\n'
    '- \u2728 \u589e\u5f3a\u5de5\u5177\u52a8\u4f5c\u63cf\u8ff0\uff1a\u53ef\u8bfb\u6807\u7b7e\u5982\u201c\u8bfb\u53d6 src/agent.ts\u201d\u3001\u201c\u641c\u7d22 pattern\u201d / Enhanced tool action descriptions with human-readable labels\n'
    '- \u2728 \u65b0\u589e\u7ed3\u6784\u5316\u8fdb\u5ea6\u8ddf\u8e2a\uff1a\u5b8c\u6210\u6570\u3001\u9519\u8bef\u6570\u3001\u65e0\u8fdb\u5c55\u6570\u3001\u8fdb\u5c55\u5de5\u5177\u6570\u3001\u53ea\u8bfb\u6210\u529f\u6570 / Added structured progress tracking per round\n'
    '- \u2728 \u5f15\u5165\u6a21\u5757\u5316 webview \u6d88\u606f\u7ec4\u4ef6\uff08ChatBubble\u3001CodeBlock\u3001DiffView\u3001StreamingRenderer\u3001ThinkingBlock\u3001ToolCard\uff09/ Introduced modular webview message components\n'
    '- \u26a1 \u6539\u8fdb Agent \u505c\u6ede\u68c0\u6d4b\uff1a\u53ea\u8bfb\u6210\u529f\u6309\u5de5\u5177\u8c03\u7528\u8ba1\u6570\u800c\u975e\u5e03\u5c14\u503c / Improved stall detection: read-only success counts individual tool calls\n'
    '- \U0001f527 \u91cd\u6784 webview \u6d88\u606f\u6a21\u5757\u4e3a\u72ec\u7acb\u7ec4\u4ef6\u6587\u4ef6 / Refactored webview messages into separate component files\n'
    '- \U0001f3a8 \u589e\u5f3a\u804a\u5929 UI \u6837\u5f0f\uff08\u601d\u8003\u5757\u3001\u5de5\u5177\u5361\u7247\u3001diff \u89c6\u56fe\uff09/ Enhanced chat UI styles\n'
    '\n'
)

content = content[:idx] + new_entry + content[idx:]

with open('README.md', 'w', encoding='utf-8') as f:
    f.write(content)

print("OK: README.md updated")
