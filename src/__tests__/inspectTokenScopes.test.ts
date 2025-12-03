/*
 * Jest tests for inspectTokenScopesHandler functionality in VSCode extension.
 */

import { inspectTokenScopesHandler } from '../commands/inspectTokenScopes';
import * as vscode from 'vscode';
import * as path from 'path';

// Read the actual app.jac file content before mocking fs
const actualFs = jest.requireActual('fs') as typeof import('fs');
const appJacPath = path.join(process.cwd(), 'examples', 'app.jac');
const appJacContent = actualFs.readFileSync(appJacPath, 'utf-8');

// Create mock output channel outside the factory so it persists
const mockOutputChannel = {
  clear: jest.fn(),
  show: jest.fn(),
  appendLine: jest.fn(),
};

// Mock vscode module
jest.mock('vscode', () => {
  return {
    window: {
      activeTextEditor: undefined as any,
      showErrorMessage: jest.fn(),
      showInformationMessage: jest.fn(),
      createOutputChannel: jest.fn(),
    },
  };
});

// Mock fs module
jest.mock('fs', () => ({
  readFileSync: jest.fn(),
}));

// Mock vscode-textmate
jest.mock('vscode-textmate', () => ({
  Registry: jest.fn(),
  INITIAL: {},
}));

// Mock vscode-oniguruma
jest.mock('vscode-oniguruma', () => ({
  loadWASM: jest.fn(),
  OnigScanner: jest.fn(),
  OnigString: jest.fn(),
}));

describe('inspectTokenScopesHandler', () => {
  let mockContext: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockContext = {
      extensionPath: '/mock/extension/path',
      subscriptions: [],
    };

    // Reset activeTextEditor to undefined
    (vscode.window as any).activeTextEditor = undefined;
    
    // Setup createOutputChannel to return the mock
    (vscode.window.createOutputChannel as jest.Mock).mockReturnValue(mockOutputChannel);
  });

  test('should output token scopes for app.jac file', async () => {
    (vscode.window as any).activeTextEditor = {
      document: {
        languageId: 'jac',
        fileName: 'app.jac',
        getText: jest.fn(() => appJacContent),
      },
    };

    // Mock fs.readFileSync
    const fs = require('fs');
    fs.readFileSync.mockImplementation((filePath: string) => {
      if (filePath.includes('onig.wasm')) {
        return { buffer: new ArrayBuffer(0) };
      }
      if (filePath.includes('jac.tmLanguage.json')) {
        return JSON.stringify({ scopeName: 'source.jac', patterns: [] });
      }
      return '';
    });

    // Mock vscode-textmate Registry with tokens for the actual app.jac content
    const vsctm = require('vscode-textmate');
    
    vsctm.Registry.mockImplementation(() => ({
      loadGrammar: jest.fn().mockResolvedValue({
        tokenizeLine: jest.fn((line: string) => {
          if (line.includes('with')) {
            return {
              tokens: [
                { startIndex: 0, endIndex: 4, scopes: ['source.jac', 'keyword.control.jac'] },
              ],
              ruleStack: {},
            };
          }
          if (line.includes('print')) {
            return {
              tokens: [
                { startIndex: 4, endIndex: 9, scopes: ['source.jac', 'support.function.builtin.jac'] },
              ],
              ruleStack: {},
            };
          }
          if (line.includes('<h1>')) {
            return {
              tokens: [
                { startIndex: 12, endIndex: 13, scopes: ['source.jac', 'meta.jsx.jac', 'punctuation.definition.tag.begin.jac'] },
                { startIndex: 13, endIndex: 15, scopes: ['source.jac', 'meta.jsx.jac', 'entity.name.tag.jac'] },
                { startIndex: 15, endIndex: 16, scopes: ['source.jac', 'meta.jsx.jac', 'punctuation.definition.tag.end.jac'] },
              ],
              ruleStack: {},
            };
          }
          if (line.includes('<button')) {
            return {
              tokens: [
                { startIndex: 12, endIndex: 13, scopes: ['source.jac', 'meta.jsx.jac', 'punctuation.definition.tag.begin.jac'] },
                { startIndex: 13, endIndex: 19, scopes: ['source.jac', 'meta.jsx.jac', 'entity.name.tag.jac'] },
                { startIndex: 20, endIndex: 27, scopes: ['source.jac', 'meta.jsx.jac', 'entity.other.attribute-name.jac'] },
              ],
              ruleStack: {},
            };
          }
          if (line.includes('<ButtonComponent')) {
            return {
              tokens: [
                { startIndex: 12, endIndex: 13, scopes: ['source.jac', 'meta.jsx.jac', 'punctuation.definition.tag.begin.jac'] },
                { startIndex: 13, endIndex: 28, scopes: ['source.jac', 'meta.jsx.jac', 'support.class.component.jac'] },
                { startIndex: 29, endIndex: 34, scopes: ['source.jac', 'meta.jsx.jac', 'entity.other.attribute-name.jac'] },
              ],
              ruleStack: {},
            };
          }
          if (line.includes('<NavLink')) {
            return {
              tokens: [
                { startIndex: 12, endIndex: 13, scopes: ['source.jac', 'meta.jsx.jac', 'punctuation.definition.tag.begin.jac'] },
                { startIndex: 13, endIndex: 20, scopes: ['source.jac', 'meta.jsx.jac', 'support.class.component.jac'] },
                { startIndex: 21, endIndex: 23, scopes: ['source.jac', 'meta.jsx.jac', 'entity.other.attribute-name.jac'] },
              ],
              ruleStack: {},
            };
          }
          if (line.includes('lambda')) {
            return {
              tokens: [
                { startIndex: 29, endIndex: 35, scopes: ['source.jac', 'keyword.control.lambda.jac'] },
              ],
              ruleStack: {},
            };
          }
          return { tokens: [], ruleStack: {} };
        }),
      }),
    }));

    await inspectTokenScopesHandler(mockContext);

    // Verify output channel received token information
    const appendLineCalls = mockOutputChannel.appendLine.mock.calls.map((call: any) => call[0]);

    // Verify output channel was created
    expect(vscode.window.createOutputChannel).toHaveBeenCalledWith('Jac Token Scopes');
    
    // Verify header was written
    expect(appendLineCalls[0]).toBe('Token Scopes for: app.jac');
    
    // Verify 'with' keyword token output (line 5 in app.jac)
    expect(appendLineCalls).toContain('with: 5:1 - 5:5:1-5');
    expect(appendLineCalls).toContain('  scopes: source.jac, keyword.control.jac');
    
    // Verify 'print' builtin function token output (line 6 in app.jac)
    expect(appendLineCalls).toContain('print: 6:5 - 6:10:5-10');
    expect(appendLineCalls).toContain('  scopes: source.jac, support.function.builtin.jac');

    // Verify JSX <h1> tag (line 15)
    expect(appendLineCalls).toContain('h1: 15:14 - 15:16:14-16');
    expect(appendLineCalls).toContain('  scopes: source.jac, meta.jsx.jac, entity.name.tag.jac');

    // Verify JSX <button> tag with onClick attribute (line 17)
    expect(appendLineCalls).toContain('button: 17:14 - 17:20:14-20');
    expect(appendLineCalls).toContain('onClick: 17:21 - 17:28:21-28');
    expect(appendLineCalls).toContain('  scopes: source.jac, meta.jsx.jac, entity.other.attribute-name.jac');

    // Verify JSX <ButtonComponent> (PascalCase component - line 20)
    expect(appendLineCalls).toContain('ButtonComponent: 20:14 - 20:29:14-29');
    expect(appendLineCalls).toContain('  scopes: source.jac, meta.jsx.jac, support.class.component.jac');
    expect(appendLineCalls).toContain('label: 20:30 - 20:35:30-35');

    // Verify JSX <NavLink> component with 'to' attribute (line 21)
    expect(appendLineCalls).toContain('NavLink: 21:14 - 21:21:14-21');
    expect(appendLineCalls).toContain('to: 21:22 - 21:24:22-24');
  });
});
