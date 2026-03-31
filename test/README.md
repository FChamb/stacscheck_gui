# stacscheck GUI

A VS Code extension for running and authoring `stacscheck` test suites.

This project was developed as part of a dissertation project at the University of St Andrews. It provides a graphical interface for `stacscheck`, an internal command-line testing tool used in the School of Computer Science. The extension is designed to make the tool easier to use for students running tests and for lecturers creating and maintaining test suites.

## Features

### Student-facing workflow
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
- Access a multi-step startup wizard for scaffolding a new stacscheck suite
- Create suite folders, `build-all.sh`, `prog-run.sh`, and optional CheckStyle support
- Use the recorder workflow for rapid test creation

### Setup script
- Includes a standalone shell script for lecturers who do not use VS Code
- Supports both interactive setup and non-interactive one-command generation
- Mirrors the same suite scaffolding logic as the VS Code wizard

## Extension layout

The extension appears as its own activity bar icon in VS Code and opens a control panel containing:
- test-directory setup
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
```

for the `stacscheck` binary.

## Installation

### Install from source

Clone the repository, then run:

```bash
npm install
npm run compile
```

Open the project in VS Code and press `F5` to launch the Extension Development Host.

### Install from VSIX

If packaging the extension:

```bash
npx @vscode/vsce package
```

Then in VS Code:
- open the Extensions panel
- open the `...` menu
- choose **Install from VSIX...**
- select the generated `.vsix` file

## Usage

### Running tests
1. Open the stacscheck activity-bar icon.
2. Select the test root directory.
3. Choose a suite if multiple suites are found.
4. Click **Run Tests**.
5. Inspect the parsed results in the control panel.

### Adding a custom test
1. Select the test root and suite.
2. Click **Add Custom Test**.
3. Enter a test name, input, and expected output.
4. The extension creates matching `.in` and `.out` files in the selected suite.

### Teacher mode
1. Enable **Teacher Mode**.
2. Use **Start Setup Wizard** to scaffold a new suite.
3. Optionally use **Record Tests** to support faster test creation workflows.

## Shell setup script

The repository also includes:

```text
setup-stacscheck-suite.sh
```

This script creates a starter stacscheck suite outside VS Code.

### Interactive mode

```bash
./setup-stacscheck-suite.sh
```

### Non-interactive mode

```bash
./setup-stacscheck-suite.sh \
  --preset java-basic \
  --root Tests \
  --practical "Week 5 Practical" \
  --course CS1002 \
  --srcdir source \
  --compile "javac *.java" \
  --run "java W05Practical" \
  --suites "basic,input-validation,edge-cases" \
  --checkstyle no \
  --non-interactive
```

## Notes

- The extension performs best-effort suite discovery based on realistic stacscheck structures.
- Working directory resolution is designed to support projects where tests and source code are stored separately.
- The CheckStyle scaffold generates a course-derived config filename such as `cs1002_checks.xml`.

## Development

Useful commands:

```bash
npm run compile
npm run lint
```

To package:

```bash
npx @vscode/vsce package
```
