# stacscheck GUI (VS Code Extension)

**A Visual Interface for the University of St Andrews' _stacscheck_ Tool**

This project is a **VS Code extension** developed as part of my 4th-year dissertation project.  
It provides a graphical interface for running and reviewing results from the `stacscheck` program — a command-line tool used in the School of Computer Science to automatically test student code submissions.

The goal is to make `stacscheck` easier, faster, and more intuitive to use, especially for students who prefer working in VS Code rather than the terminal.

---

## Features

- **Tree View Interface** in VS Code for running tests
  - Select a test directory directly from within the IDE
  - Run tests with a single click (`Run Tests`)
  - View all test results in an expandable/collapsible tree structure
  - Colour-coded pass/fail icons using VS Code’s native testing theme

- **Automatic working directory detection**
  - Automatically searches for `src/` or `source/` directories relative to your test folder
  - If not found, prompts you to manually select the correct code directory

- **Persistent settings**
  - Remembers the last selected test directory between sessions (optional)

- **CLI Integration**
  - Executes the official `/cs/studres/Library/stacscheck/stacscheck` binary directly from VS Code
  - Displays output in the sidebar view

---

## Installation

### Install from VSIX

1. Download the latest `.vsix` file
2. In VS Code:
   - Open the Extensions panel (`Ctrl+Shift+X` / `Cmd+Shift+X`).
   - Click the `...` menu → **Install from VSIX...**
   - Select the `.vsix` file.
3. The extension will appear as **“stacscheck GUI”** in the activity bar.