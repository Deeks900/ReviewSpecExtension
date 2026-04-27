import * as vscode from 'vscode';
import axios from 'axios';

let panel: vscode.WebviewPanel | undefined;
let decorationType: vscode.TextEditorDecorationType | undefined;

// ✅ session state (real fix)
let isReviewMode = false;

export function activate(context: vscode.ExtensionContext) {
    console.log("Spec Reviewer Activated");
    vscode.window.showInformationMessage("Spec Reviewer has been activated");

    // ✅ IMPORTANT: detect edits → exit review mode + clear highlights
    vscode.workspace.onDidChangeTextDocument((event) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        isReviewMode = false;

        if (decorationType) {
            editor.setDecorations(decorationType, []);
        }
    });

    const disposable = vscode.commands.registerCommand('spec-reviewer.reviewSpec', async () => {

        const editor = vscode.window.activeTextEditor;

        if (!editor) {
            vscode.window.showErrorMessage('No file open');
            return;
        }

        const text = editor.document.getText();

        const provider = await vscode.window.showQuickPick(
            ['gemini', 'claude'],
            { placeHolder: 'Select AI Provider' }
        );

        if (!provider) return;

        const apiKey = await vscode.window.showInputBox({
            prompt: `Enter your ${provider} API Key`,
            ignoreFocusOut: true,
            password: true
        });

        if (!apiKey) return;

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Analyzing spec...",
            cancellable: false
        }, async () => { });

        try {

            const response = await axios.post('https://reviewspecbackend.onrender.com/analyze', {
                content: text,
                provider,
                api_key: apiKey
            });

            const data = response.data ?? {};
            const ai = data.ai_analysis ?? {};
            const enhanced = data.enhanced_spec ?? "No suggestion generated";

            const ruleIssues = [
                ...(data.rule_issues ?? []),
                ...((ai.ambiguities ?? []).map((x: string) => ({
                    type: "ambiguity",
                    message: x
                })))
            ];

            // ✅ ENTER review mode ONLY after analysis
            isReviewMode = true;

            // ------------------ CLEAR OLD DECORATIONS ------------------

            if (decorationType && editor) {
                editor.setDecorations(decorationType, []);
                decorationType.dispose();
                decorationType = undefined;
            }

            const decorations: vscode.DecorationOptions[] = [];

            // ❌ BLOCK if not in review mode
            if (!isReviewMode) {
                return;
            }

            const textContent = editor.document.getText();

            ruleIssues.forEach((issue: any) => {

                if (issue.type !== 'ambiguity') return;

                const wordMatch = issue.message.match(/'(.*?)'/);
                if (!wordMatch) return;

                const word = wordMatch[1];

                const regex = new RegExp(word, 'gi');
                let match;

                while ((match = regex.exec(textContent))) {

                    const start = editor.document.positionAt(match.index);
                    const end = editor.document.positionAt(match.index + word.length);

                    decorations.push({
                        range: new vscode.Range(start, end),
                        hoverMessage: issue.message
                    });
                }
            });

            decorationType = vscode.window.createTextEditorDecorationType({
                backgroundColor: 'rgba(255, 75, 75, 0.25)',
                border: '1px solid rgba(255, 75, 75, 0.6)'
            });

            editor.setDecorations(decorationType, decorations);

            // ------------------ WEBVIEW ------------------

            if (!panel) {
                panel = vscode.window.createWebviewPanel(
                    'specReviewer',
                    'Spec Reviewer',
                    vscode.ViewColumn.Beside,
                    {
                        enableScripts: true,
                        retainContextWhenHidden: true
                    }
                );

                panel.onDidDispose(() => {
                    panel = undefined;
                });

                panel.webview.onDidReceiveMessage(async (message) => {

                    if (message.command === 'copy') {
                        await vscode.env.clipboard.writeText(message.text);
                        vscode.window.showInformationMessage("✨ Improved spec copied!");
                    }
                });

            } else {
                panel.reveal(vscode.ViewColumn.Beside);
            }

            const list = (arr: string[]) => {
                if (!arr || arr.length === 0) return `<p class="muted">None</p>`;
                return `<ul>${arr.map(i => `<li>${i}</li>`).join('')}</ul>`;
            };

            panel.webview.html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<style>
body {
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    padding: 20px;
    background: #0f111a;
    color: #e6e6e6;
    line-height: 1.5;
}

h1 { font-size: 18px; margin-bottom: 16px; }

h2 {
    font-size: 12px;
    margin-top: 18px;
    color: #7cc7ff;
    letter-spacing: 0.08em;
    text-transform: uppercase;
}

.card {
    background: #161b22;
    border: 1px solid #2a2f3a;
    border-radius: 12px;
    padding: 14px;
    margin-top: 10px;
}

ul { padding-left: 18px; }
li { margin-bottom: 6px; }

pre {
    white-space: pre-wrap;
    background: #0d1117;
    padding: 12px;
    border-radius: 10px;
    border: 1px solid #2a2f3a;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

button {
    margin-top: 10px;
    padding: 10px 14px;
    background: linear-gradient(135deg, #4fc3f7, #38bdf8);
    border: none;
    border-radius: 10px;
    cursor: pointer;
    font-weight: 600;
    color: #0f111a;
}

button:hover {
    transform: translateY(-1px);
}

.muted { opacity: 0.6; }
</style>
</head>

<body>

<h1>🧠 Spec Reviewer</h1>

<h2>🚨 Issues to Fix</h2>
<div class="card">
    ${list(ruleIssues.map((i: any) => i.message))}
</div>

<h2>⚠️ Risks</h2>
<div class="card">
    ${list(ai.risks ?? [])}
</div>

<h2>✨ Improved Spec</h2>
<div class="card">
    <pre>${enhanced}</pre>

    <button onclick="copySpec()">Copy Improved Spec</button>
</div>

<script>
const vscode = acquireVsCodeApi();

function copySpec() {
    vscode.postMessage({
        command: 'copy',
        text: \`${enhanced.replace(/`/g, "\\`")}\`
    });
}
</script>

</body>
</html>
`;

        } catch (err: any) {
            console.error(err);
            vscode.window.showErrorMessage(`Backend error: ${err.message}`);
        }
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {}