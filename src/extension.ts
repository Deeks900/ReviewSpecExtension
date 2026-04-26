import * as vscode from 'vscode';
import axios from 'axios';

let panel: vscode.WebviewPanel | undefined;
let decorationType: vscode.TextEditorDecorationType | undefined;

export function activate(context: vscode.ExtensionContext) {

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
            ignoreFocusOut: true
        });

        if (!apiKey) return;

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Analyzing spec...",
            cancellable: false
        }, async () => {});

        try {

            const response = await axios.post('https://reviewspecbackend.onrender.com/analyze', {
                content: text,
                provider,
                api_key: apiKey
            });

            const data = response.data ?? {};
            const ai = data.ai_analysis ?? {};
            const enhanced = data.enhanced_spec ?? "No suggestion generated";

            // ------------------ NORMALIZE ISSUES ------------------

            const ruleIssues = [
                ...(data.rule_issues ?? []),
                ...((ai.ambiguities ?? []).map((x: string) => ({
                    type: "ambiguity",
                    message: x
                })))
            ];

            // ------------------ HIGHLIGHT AMBIGUOUS TERMS ------------------

            if (decorationType) {
                decorationType.dispose();
            }

            const decorations: vscode.DecorationOptions[] = [];
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

            setTimeout(() => {
                editor.setDecorations(decorationType!, decorations);
            }, 30);

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
            } else {
                panel.reveal();
            }

            // ------------------ COPY HANDLER ------------------

            panel.webview.onDidReceiveMessage(async (message) => {

                if (message.command === 'copy') {
                    await vscode.env.clipboard.writeText(message.text);
                    vscode.window.showInformationMessage("✨ Improved spec copied!");
                }
            });

            // ------------------ LIST HELPER ------------------

            const list = (arr: string[]) => {
                if (!arr || arr.length === 0) return `<p class="muted">None</p>`;
                return `<ul>${arr.map(i => `<li>${i}</li>`).join('')}</ul>`;
            };

            // ------------------ BEAUTIFUL UI ------------------

            panel.webview.html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');

body {
    font-family: Inter, -apple-system, BlinkMacSystemFont, sans-serif;
    padding: 20px;
    background: #0f111a;
    color: #e6e6e6;
}

h1 {
    font-size: 18px;
    margin-bottom: 16px;
}

h2 {
    font-size: 13px;
    margin-top: 18px;
    color: #7cc7ff;
    text-transform: uppercase;
}

.card {
    background: #161b22;
    border: 1px solid #2a2f3a;
    border-radius: 12px;
    padding: 14px;
    margin-top: 10px;
}

ul {
    padding-left: 18px;
}

li {
    margin-bottom: 6px;
}

pre {
    white-space: pre-wrap;
    background: #0d1117;
    padding: 12px;
    border-radius: 10px;
    border: 1px solid #2a2f3a;
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

.muted {
    opacity: 0.6;
}
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

<h2>❓ Clarifications Needed</h2>
<div class="card">
    ${list([
        ...(ai.ambiguities ?? []),
        ...(ai.measurability_issues ?? [])
    ])}
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
        }

        catch (err: any) {
            vscode.window.showErrorMessage('Error calling backend');
            console.error(err);
        }
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {}