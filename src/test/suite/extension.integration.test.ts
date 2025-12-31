import * as vscode from 'vscode';
import { expect } from 'chai';
import * as path from 'path';

describe('Extension Integration Tests', () => {
    let workspacePath: string;

    before(() => {
        const folders = vscode.workspace.workspaceFolders;
        expect(folders).to.exist;
        expect(folders?.length).to.be.greaterThan(0);
        workspacePath = folders![0].uri.fsPath;
    });

    // Test Group 1: Extension Activation
    // Verify VS Code extension infrastructure is properly set up
    describe('Test 1: Extension Activation', () => {
        // Verify extension can be loaded and activated in VS Code
        it('should activate the Jac extension', async () => {
            const ext = vscode.extensions.getExtension('jaseci-labs.jaclang-extension');
            expect(ext).to.exist;

            await ext!.activate();
            expect(ext!.isActive).to.be.true;
        });

        // Verify VS Code recognizes 'jac' as a supported language
        it('should register Jac language', async () => {
            const languages = await vscode.languages.getLanguages();
            expect(languages).to.include('jac');
        });

        // Verify test workspace with sample files is properly opened
        it('should load test workspace with fixtures', () => {
            const folders = vscode.workspace.workspaceFolders;

            expect(folders).to.exist;
            expect(folders!.length).to.equal(1);
            expect(folders![0].uri.fsPath).to.include('fixtures/workspace');
        });

        // Verify sample.jac file is recognized as a JAC file with syntax highlighting
        it('should open sample.jac and detect language correctly', async () => {
            const filePath = path.join(workspacePath, 'sample.jac');
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));

            expect(doc).to.exist;
            expect(doc.fileName).to.include('sample.jac');
            expect(doc.languageId).to.equal('jac');
        });
    });
});
