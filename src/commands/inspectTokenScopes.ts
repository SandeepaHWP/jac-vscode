import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as vsctm from 'vscode-textmate';
import * as oniguruma from 'vscode-oniguruma';

// Flag to track if oniguruma has been initialized
let onigurumaInitialized = false;

/**
 * Initialize the oniguruma WASM library required for TextMate grammar parsing.
 * This only needs to be done once per session.
 */
async function initOnigurumaWithPath(wasmPath: string): Promise<void> {
    if (onigurumaInitialized) {
        return;
    }

    const wasmBin = fs.readFileSync(wasmPath).buffer;
    await oniguruma.loadWASM(wasmBin);
    onigurumaInitialized = true;
}

/**
 * Create an Oniguruma scanner from the given patterns.
 */
export function createOnigScanner(patterns: string[]): oniguruma.OnigScanner {
    return new oniguruma.OnigScanner(patterns);
}

/**
 * Create an Oniguruma string from the given source string.
 */
export function createOnigString(s: string): oniguruma.OnigString {
    return new oniguruma.OnigString(s);
}

/**
 * Interface for a tokenized token with position info
 */
export interface TokenInfo {
    text: string;
    line: number;
    startCol: number;
    endCol: number;
    scopes: string[];
}

/**
 * Location key format: "line:startCol-endCol" (1-based)
 */
export type TokenLocation = string;

/**
 * Result of tokenization - maps location to token info
 */
export interface TokenizeResult {
    /** Map of "line:startCol-endCol" -> TokenInfo */
    byLocation: Map<TokenLocation, TokenInfo>;
    /** Array of all tokens in order */
    tokens: TokenInfo[];
}

/**
 * Helper to get token at a specific location from TokenizeResult
 * @param result The tokenization result
 * @param line Line number (1-based)
 * @param startCol Start column (1-based)
 * @param endCol End column (1-based)
 * @returns TokenInfo if found, undefined otherwise
 */
export function getTokenByLocation(
    result: TokenizeResult,
    line: number,
    startCol: number,
    endCol: number
): TokenInfo | undefined {
    return result.byLocation.get(`${line}:${startCol}-${endCol}`);
}

/**
 * Tokenize content using the Jac grammar.
 * @param content The content to tokenize
 * @param grammarPath Path to the jac.tmLanguage.json file
 * @param wasmPath Path to the onig.wasm file
 * @returns TokenizeResult with tokens indexed by location
 */
export async function tokenizeContent(
    content: string,
    grammarPath: string,
    wasmPath: string
): Promise<TokenizeResult> {
    await initOnigurumaWithPath(wasmPath);

    const grammarContent = fs.readFileSync(grammarPath, 'utf-8');
    const grammarData = JSON.parse(grammarContent);

    const registry = new vsctm.Registry({
        onigLib: Promise.resolve({
            createOnigScanner,
            createOnigString,
        }),
        loadGrammar: async (scopeName: string) => {
            if (scopeName === 'source.jac') {
                return grammarData;
            }
            return null;
        },
    });

    const grammar = await registry.loadGrammar('source.jac');
    if (!grammar) {
        throw new Error('Failed to load grammar');
    }

    const byLocation = new Map<TokenLocation, TokenInfo>();
    const tokens: TokenInfo[] = [];
    let ruleStack = vsctm.INITIAL;
    const lines = content.split('\n');

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        const lineNumber = lineIndex + 1; // 1-based

        const lineTokens = grammar.tokenizeLine(line, ruleStack);

        for (const token of lineTokens.tokens) {
            const tokenText = line.substring(token.startIndex, token.endIndex);
            // Skip whitespace-only tokens
            if (tokenText.trim() === '') {
                continue;
            }

            const startCol = token.startIndex + 1; // 1-based
            const endCol = token.endIndex + 1;     // 1-based
            const location: TokenLocation = `${lineNumber}:${startCol}-${endCol}`;

            const tokenInfo: TokenInfo = {
                text: tokenText,
                line: lineNumber,
                startCol,
                endCol,
                scopes: token.scopes
            };

            byLocation.set(location, tokenInfo);
            tokens.push(tokenInfo);
        }

        ruleStack = lineTokens.ruleStack;
    }

    return { byLocation, tokens };
}

/**
 * Handler for the Inspect Token Scopes command.
 * This command dumps all TextMate token scopes for the current Jac file.
 *
 * @param context The extension context
 */
export async function inspectTokenScopesHandler(context: vscode.ExtensionContext): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('No active editor. Please open a Jac file first.');
        return;
    }

    const document = editor.document;

    // Only work with Jac files
    if (document.languageId !== 'jac') {
        vscode.window.showErrorMessage('This command only works with Jac files. Please open a .jac file.');
        return;
    }

    // Create output channel for token scopes
    const outputChannel = vscode.window.createOutputChannel('Jac Token Scopes');
    outputChannel.clear();
    outputChannel.show(true);

    outputChannel.appendLine(`Token Scopes for: ${document.fileName}`);
    outputChannel.appendLine('='.repeat(80));
    outputChannel.appendLine('');

    try {
        // Initialize oniguruma WASM
        const wasmPath = path.join(
            context.extensionPath,
            'node_modules',
            'vscode-oniguruma',
            'release',
            'onig.wasm'
        );
        await initOnigurumaWithPath(wasmPath);

        // Load the Jac TextMate grammar
        const grammarPath = path.join(context.extensionPath, 'syntaxes', 'jac.tmLanguage.json');
        const grammarContent = fs.readFileSync(grammarPath, 'utf-8');
        const grammarData = JSON.parse(grammarContent);

        // Create the registry with oniguruma
        const registry = new vsctm.Registry({
            onigLib: Promise.resolve({
                createOnigScanner,
                createOnigString
            }),
            loadGrammar: async (scopeName: string) => {
                if (scopeName === 'source.jac') {
                    return grammarData;
                }
                return null;
            }
        });

        // Load the grammar
        const grammar = await registry.loadGrammar('source.jac');

        if (!grammar) {
            outputChannel.appendLine('Failed to load Jac grammar.');
            return;
        }

        // Tokenize each line
        let ruleStack = vsctm.INITIAL;
        const text = document.getText();
        const lines = text.split('\n');

        // Collect all tokens first
        const allTokens: TokenInfo[] = [];

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const line = lines[lineIndex];
            const lineNumber = lineIndex + 1; // 1-based line number

            const lineTokens = grammar.tokenizeLine(line, ruleStack);

            for (const token of lineTokens.tokens) {
                const tokenText = line.substring(token.startIndex, token.endIndex);
                // Skip whitespace-only tokens
                if (tokenText.trim() === '') {
                    continue;
                }

                allTokens.push({
                    text: tokenText,
                    line: lineNumber,
                    startCol: token.startIndex + 1, // 1-based column
                    endCol: token.endIndex + 1,     // 1-based column
                    scopes: token.scopes
                });
            }

            ruleStack = lineTokens.ruleStack;
        }

        // Output in the format:
        // token: line:startCol - line:endCol:startCol-endCol
        for (const token of allTokens) {
            const posInfo = `${token.line}:${token.startCol} - ${token.line}:${token.endCol}:${token.startCol}-${token.endCol}`;
            outputChannel.appendLine(`${token.text}: ${posInfo}`);
            outputChannel.appendLine(`  scopes: ${token.scopes.join(', ')}`);
        }

        // Also print the source code at the end
        outputChannel.appendLine('');
        outputChannel.appendLine('--- Source Code ---');
        outputChannel.appendLine(text);

    } catch (error) {
        outputChannel.appendLine(`Error: ${error}`);
        console.error('Token inspection error:', error);
    }

    vscode.window.showInformationMessage('Token scopes printed to "Jac Token Scopes" output channel.');
}
