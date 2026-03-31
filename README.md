# stacscheck GUI

A VS Code extension for running and authoring `stacscheck` test suites.

This project was developed as part of a dissertation project at the University of St Andrews. It provides a graphical interface for `stacscheck`. The extension is designed to make the tool easier to use for students running tests and for lecturers creating and maintaining test suites.

## Features

### Student facing workflow
- Select a stacscheck test root directly from within VS Code
- Discover available suites automatically
- Choose a suite from the control panel
- Run tests from the IDE
- View parsed results in a structured, readable format
- Inspect failing test details without leaving the editor

### Test authoring
- Create custom `.in` / `.out` test pairs directly from the extension
- Avoid manual file creation for simple test additions
- Write tests into the currently selected suite

### Teacher mode
- Enable a dedicated teacher mode inside the control panel
- Access a multi step startup wizard for scaffolding a new stacscheck suite
- Create suite folders, `build-all.sh`, `prog-run.sh`, and optional CheckStyle support
- Use the recorder workflow for rapid test creation

### Setup script
- Includes a standalone shell script for lecturers who do not use VS Code
- Supports both interactive setup and non interactive one command generation
- Mirrors the same suite scaffolding logic as the VS Code wizard

## Extension layout

The extension appears as its own activity bar icon in VS Code and opens a control panel containing:
- test directory setup
- suite selection
- test execution controls
- teacher mode actions
- parsed results
- startup wizard

## Requirements

The extension assumes:
- Visual Studio Code `^1.104.0`
- access to the `stacscheck` executable
- a project layout where source code lives in `src/` or `source/`, or where the correct code directory can be selected manually

By default, the extension uses:

```text
/cs/studres/Library/stacscheck/stacscheck