import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class JacDefinitionProvider implements vscode.DefinitionProvider {
    
    /**
     * Provides definition for Python imports that reference Jac modules
     */
    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Definition | null> {
        
        // Only handle Python files
        if (document.languageId !== 'python') {
            return null;
        }

        // Early return if token is cancelled
        if (token.isCancellationRequested) {
            return null;
        }

        const line = document.lineAt(position.line);
        const lineText = line.text;
        
        // Check if we're on an import line
        const importMatch = this.matchImportStatement(lineText, position.character);
        if (!importMatch) {
            return null;
        }

        const { moduleName } = importMatch;
        
        // Debug logging
        const config = vscode.workspace.getConfiguration('jaclang-extension');
        const developerMode = config.get<boolean>('developerMode', false);
        
        if (developerMode) {
            vscode.window.showInformationMessage(`Jac: Looking for module "${moduleName}"`);
        }
        
        // Try to resolve the Jac module
        const jacFilePath = await this.resolveJacModule(document.uri, moduleName);
        if (!jacFilePath) {
            if (developerMode) {
                vscode.window.showInformationMessage(`Jac: Could not find Jac module "${moduleName}"`);
            }
            return null;
        }

        if (developerMode) {
            vscode.window.showInformationMessage(`Jac: Found module at "${jacFilePath}"`);
        }

        // Return the definition location
        return new vscode.Location(
            vscode.Uri.file(jacFilePath),
            new vscode.Position(0, 0)
        );
    }

    /**
     * Match import statements and extract module name under cursor
     */
    private matchImportStatement(lineText: string, characterPos: number): { moduleName: string } | null {
        // Patterns to match different import styles:
        // import module
        // import module.submodule
        // from module import something
        // import module as alias
        
        const patterns = [
            // import module [as alias]
            /^(\s*)import\s+([\w\.]+)(\s+as\s+\w+)?/,
            // from module import ...
            /^(\s*)from\s+([\w\.]+)\s+import/,
            // Multi-line import with parentheses: import (
            /^(\s*)import\s*\(\s*([\w\.]+)/,
            // Multi-import: import module1, module2
            /^(\s*)import\s+([\w\.\s,]+)/
        ];

        for (const pattern of patterns) {
            const match = lineText.match(pattern);
            if (match) {
                let modulePart = match[2]; // The module name part
                
                // Handle multi-import case: find which module is under cursor
                if (pattern.source.includes('[\\w\\.\\s,]+')) {
                    const modules = modulePart.split(',').map(m => m.trim());
                    let currentPos = match[0].indexOf(modulePart);
                    
                    for (const module of modules) {
                        const moduleStart = lineText.indexOf(module, currentPos);
                        const moduleEnd = moduleStart + module.length;
                        
                        if (characterPos >= moduleStart && characterPos <= moduleEnd) {
                            modulePart = module.trim();
                            break;
                        }
                        currentPos = moduleEnd;
                    }
                }
                
                const importStart = lineText.indexOf(modulePart);
                const importEnd = importStart + modulePart.length;
                
                // Check if cursor is within the module name
                if (characterPos >= importStart && characterPos <= importEnd) {
                    // Handle dotted imports (e.g., app.submodule -> app)
                    const moduleSegments = modulePart.split('.');
                    let currentPos = importStart;
                    
                    for (let i = 0; i < moduleSegments.length; i++) {
                        const segment = moduleSegments[i];
                        const segmentEnd = currentPos + segment.length;
                        
                        if (characterPos >= currentPos && characterPos <= segmentEnd) {
                            // Return the module path up to this segment
                            return {
                                moduleName: moduleSegments.slice(0, i + 1).join('.')
                            };
                        }
                        currentPos = segmentEnd + 1; // +1 for the dot
                    }
                }
            }
        }
        
        return null;
    }

    /**
     * Resolve a module name to a Jac file path
     */
    private async resolveJacModule(documentUri: vscode.Uri, moduleName: string): Promise<string | null> {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);
        if (!workspaceFolder) {
            return null;
        }

        const workspaceRoot = workspaceFolder.uri.fsPath;
        const documentDir = path.dirname(documentUri.fsPath);
        
        // Convert module name to file path (replace dots with path separators)
        const modulePath = moduleName.replace(/\./g, path.sep);
        
        // Search locations in order of preference:
        const searchPaths = [
            // 1. Relative to current file
            path.resolve(documentDir, `${modulePath}.jac`),
            path.resolve(documentDir, modulePath, 'index.jac'),
            path.resolve(documentDir, modulePath, '__init__.jac'),
            
            // 2. Relative to workspace root
            path.resolve(workspaceRoot, `${modulePath}.jac`),
            path.resolve(workspaceRoot, modulePath, 'index.jac'),
            path.resolve(workspaceRoot, modulePath, '__init__.jac'),
            
            // 3. In common source directories
            path.resolve(workspaceRoot, 'src', `${modulePath}.jac`),
            path.resolve(workspaceRoot, 'src', modulePath, 'index.jac'),
            path.resolve(workspaceRoot, 'lib', `${modulePath}.jac`),
            path.resolve(workspaceRoot, 'lib', modulePath, 'index.jac'),
        ];

        // Check each path
        for (const jacPath of searchPaths) {
            if (await this.fileExists(jacPath)) {
                return jacPath;
            }
        }

        // Also search recursively in the workspace for any .jac files that match
        const foundFile = await this.searchJacFileRecursively(workspaceRoot, moduleName);
        if (foundFile) {
            return foundFile;
        }

        return null;
    }

    /**
     * Check if a file exists
     */
    private async fileExists(filePath: string): Promise<boolean> {
        try {
            const stat = await fs.promises.stat(filePath);
            return stat.isFile();
        } catch {
            return false;
        }
    }

    /**
     * Recursively search for a Jac file matching the module name
     */
    private async searchJacFileRecursively(rootDir: string, moduleName: string): Promise<string | null> {
        const baseFileName = path.basename(moduleName.replace(/\./g, path.sep));
        
        try {
            const files = await this.getAllJacFiles(rootDir);
            
            // Look for exact file name matches
            for (const file of files) {
                const fileName = path.basename(file, '.jac');
                if (fileName === baseFileName) {
                    return file;
                }
            }
            
            // Look for directory structure matches
            const modulePathParts = moduleName.split('.');
            for (const file of files) {
                const relativePath = path.relative(rootDir, file);
                const pathParts = relativePath.split(path.sep);
                
                // Remove the .jac extension from the last part
                if (pathParts.length > 0) {
                    pathParts[pathParts.length - 1] = path.basename(pathParts[pathParts.length - 1], '.jac');
                }
                
                // Check if the path structure matches the module structure
                if (this.pathMatchesModule(pathParts, modulePathParts)) {
                    return file;
                }
            }
        } catch (error: any) {
            // Log error but don't throw - just return null
            vscode.window.showInformationMessage(`Jac Extension: Error searching for files: ${error.message || error}`);
        }
        
        return null;
    }

    /**
     * Get all .jac files in a directory recursively
     */
    private async getAllJacFiles(dir: string): Promise<string[]> {
        const result: string[] = [];
        
        try {
            const entries = await fs.promises.readdir(dir, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                
                if (entry.isDirectory()) {
                    // Skip common non-source directories
                    if (!['node_modules', '.git', '.vscode', '__pycache__', '.pytest_cache'].includes(entry.name)) {
                        const subFiles = await this.getAllJacFiles(fullPath);
                        result.push(...subFiles);
                    }
                } else if (entry.isFile() && entry.name.endsWith('.jac')) {
                    result.push(fullPath);
                }
            }
        } catch (error) {
            // Directory not readable, skip it
        }
        
        return result;
    }

    /**
     * Check if a file path structure matches a module name structure
     */
    private pathMatchesModule(pathParts: string[], modulePathParts: string[]): boolean {
        if (pathParts.length !== modulePathParts.length) {
            return false;
        }
        
        for (let i = 0; i < pathParts.length; i++) {
            if (pathParts[i] !== modulePathParts[i]) {
                return false;
            }
        }
        
        return true;
    }
}