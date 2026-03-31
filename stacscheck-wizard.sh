#!/usr/bin/env bash

set -euo pipefail

# Standalone shell version of the VS Code setup wizard.
# This exists so lecturers can scaffold suites even if they are not using the extension.

show_help() {
  cat <<'EOF'
stacscheck Suite Setup Wizard

Usage:
  ./setup-stacscheck-suite.sh [options]

Modes:
  Interactive mode is used by default.
  Add --non-interactive to skip prompts and use defaults / provided flags only.

Options:
  --preset <name>             Preset to use:
                              java-basic
                              java-checkstyle
                              python-basic
                              c-basic
                              custom

  --root <path>               Test root folder
  --practical <name>          Practical name
  --course <code>             Course code
  --srcdir <dir>              Source directory
  --compile <command>         Build command
  --run <command>             Run command
  --suites <list>             Comma-separated suite list
  --checkstyle <yes|no>       Include CheckStyle scaffold
  --non-interactive           Do not prompt for input
  --force                     Overwrite existing generated files
  --help                      Show this help text

Examples:
  ./setup-stacscheck-suite.sh

  ./setup-stacscheck-suite.sh \
    --preset java-basic \
    --root Tests \
    --run "java W05Practical" \
    --suites "basic,edge-cases"

  ./setup-stacscheck-suite.sh \
    --preset java-checkstyle \
    --non-interactive

EOF
}

prompt_with_default() {
  local prompt="$1"
  local default="${2-}"
  local value

  if [ -n "$default" ]; then
    read -r -p "$prompt [$default]: " value
    if [ -z "$value" ]; then
      value="$default"
    fi
  else
    read -r -p "$prompt: " value
  fi

  printf '%s' "$value"
}

prompt_yes_no() {
  local prompt="$1"
  local default="${2:-y}"
  local value

  while true; do
    if [ "$default" = "y" ]; then
      read -r -p "$prompt [Y/n]: " value
      value="${value:-y}"
    else
      read -r -p "$prompt [y/N]: " value
      value="${value:-n}"
    fi

    case "${value,,}" in
      y|yes) return 0 ;;
      n|no) return 1 ;;
      *) echo "Please enter y or n." ;;
    esac
  done
}

# Write a file unless it already exists and overwrite was not requested.
write_file() {
  local file="$1"
  local content="$2"

  mkdir -p "$(dirname "$file")"

  if [ -e "$file" ] && [ "$FORCE_OVERWRITE" != "yes" ]; then
    echo "Skipping existing file: $file"
    return
  fi

  printf '%s' "$content" > "$file"
  echo "Created: $file"
}

make_executable_if_exists() {
  local file="$1"
  if [ -f "$file" ]; then
    chmod +x "$file"
  fi
}

# Match the extension behaviour when deriving a CheckStyle config filename.
get_checkstyle_config_file_name() {
  local course_code="$1"
  local stem
  stem="$(printf '%s' "$course_code" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]\+/_/g; s/^_*\|_*$//g')"
  if [ -z "$stem" ]; then
    stem="course"
  fi
  printf '%s_checks.xml' "$stem"
}

# Convert a comma separated suite list into clean individual suite paths.
normalise_suite_names() {
  local raw="$1"
  local out=()
  IFS=',' read -r -a parts <<< "$raw"

  for part in "${parts[@]}"; do
    local trimmed
    trimmed="$(printf '%s' "$part" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    if [ -n "$trimmed" ]; then
      out+=("$trimmed")
    fi
  done

  printf '%s\n' "${out[@]}"
}

# Presets mirror the defaults offered by the in panel wizard.
apply_preset_defaults() {
  case "$PRESET" in
    java-basic)
      DEFAULT_PRACTICAL_NAME="Practical 1"
      DEFAULT_COURSE_CODE="CS1003"
      DEFAULT_COMPILE_COMMAND="javac *.java"
      DEFAULT_RUN_COMMAND="java Main"
      DEFAULT_INCLUDE_CHECKSTYLE="no"
      DEFAULT_SUITE_NAMES="basic"
      ;;
    java-checkstyle)
      DEFAULT_PRACTICAL_NAME="Practical 1"
      DEFAULT_COURSE_CODE="CS1003"
      DEFAULT_COMPILE_COMMAND="javac *.java"
      DEFAULT_RUN_COMMAND="java Main"
      DEFAULT_INCLUDE_CHECKSTYLE="yes"
      DEFAULT_SUITE_NAMES="basic"
      ;;
    python-basic)
      DEFAULT_PRACTICAL_NAME="Practical 1"
      DEFAULT_COURSE_CODE="CS1003"
      DEFAULT_COMPILE_COMMAND="python3 -m py_compile *.py"
      DEFAULT_RUN_COMMAND="python3 main.py"
      DEFAULT_INCLUDE_CHECKSTYLE="no"
      DEFAULT_SUITE_NAMES="basic"
      ;;
    c-basic)
      DEFAULT_PRACTICAL_NAME="Practical 1"
      DEFAULT_COURSE_CODE="CS1003"
      DEFAULT_COMPILE_COMMAND="gcc -Wall -Wextra -o program *.c"
      DEFAULT_RUN_COMMAND="./program"
      DEFAULT_INCLUDE_CHECKSTYLE="no"
      DEFAULT_SUITE_NAMES="basic"
      ;;
    custom|*)
      DEFAULT_PRACTICAL_NAME="Practical 1"
      DEFAULT_COURSE_CODE="CS1003"
      DEFAULT_COMPILE_COMMAND="javac *.java"
      DEFAULT_RUN_COMMAND="java Main"
      DEFAULT_INCLUDE_CHECKSTYLE="no"
      DEFAULT_SUITE_NAMES="basic"
      ;;
  esac
}

INTERACTIVE_MODE="yes"
FORCE_OVERWRITE="no"
PRESET="java-basic"

DEFAULT_TESTS_ROOT="Tests"
if [ -d "src" ]; then
  DEFAULT_SRCDIR="src"
elif [ -d "source" ]; then
  DEFAULT_SRCDIR="source"
else
  DEFAULT_SRCDIR="src"
fi

ROOT_ARG=""
PRACTICAL_ARG=""
COURSE_ARG=""
SRCDIR_ARG=""
COMPILE_ARG=""
RUN_ARG=""
SUITES_ARG=""
CHECKSTYLE_ARG=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --preset)
      PRESET="${2:-}"
      shift 2
      ;;
    --root)
      ROOT_ARG="${2:-}"
      shift 2
      ;;
    --practical)
      PRACTICAL_ARG="${2:-}"
      shift 2
      ;;
    --course)
      COURSE_ARG="${2:-}"
      shift 2
      ;;
    --srcdir)
      SRCDIR_ARG="${2:-}"
      shift 2
      ;;
    --compile)
      COMPILE_ARG="${2:-}"
      shift 2
      ;;
    --run)
      RUN_ARG="${2:-}"
      shift 2
      ;;
    --suites)
      SUITES_ARG="${2:-}"
      shift 2
      ;;
    --checkstyle)
      CHECKSTYLE_ARG="${2:-}"
      shift 2
      ;;
    --non-interactive)
      INTERACTIVE_MODE="no"
      shift
      ;;
    --force)
      FORCE_OVERWRITE="yes"
      shift
      ;;
    --help|-h)
      show_help
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      echo
      show_help
      exit 1
      ;;
  esac
done

apply_preset_defaults

TESTS_ROOT="${ROOT_ARG:-$DEFAULT_TESTS_ROOT}"
PRACTICAL_NAME="${PRACTICAL_ARG:-$DEFAULT_PRACTICAL_NAME}"
COURSE_CODE="${COURSE_ARG:-$DEFAULT_COURSE_CODE}"
SRC_DIR="${SRCDIR_ARG:-$DEFAULT_SRCDIR}"
COMPILE_COMMAND="${COMPILE_ARG:-$DEFAULT_COMPILE_COMMAND}"
RUN_COMMAND="${RUN_ARG:-$DEFAULT_RUN_COMMAND}"
SUITE_NAMES_RAW="${SUITES_ARG:-$DEFAULT_SUITE_NAMES}"
INCLUDE_CHECKSTYLE="${CHECKSTYLE_ARG:-$DEFAULT_INCLUDE_CHECKSTYLE}"

case "${INCLUDE_CHECKSTYLE,,}" in
  y|yes|true|1) INCLUDE_CHECKSTYLE="yes" ;;
  n|no|false|0) INCLUDE_CHECKSTYLE="no" ;;
  *)
    echo "Invalid value for --checkstyle: $INCLUDE_CHECKSTYLE"
    echo "Use yes or no."
    exit 1
    ;;
esac

if [ "$INTERACTIVE_MODE" = "yes" ]; then
  echo "=============================================="
  echo " stacscheck Suite Setup Wizard (Shell Script) "
  echo "=============================================="
  echo

  echo "Choose a preset:"
  echo "  1) java-basic"
  echo "  2) java-checkstyle"
  echo "  3) python-basic"
  echo "  4) c-basic"
  echo "  5) custom"

  preset_choice="$(prompt_with_default "Preset" "$PRESET")"
  case "$preset_choice" in
    1) PRESET="java-basic" ;;
    2) PRESET="java-checkstyle" ;;
    3) PRESET="python-basic" ;;
    4) PRESET="c-basic" ;;
    5) PRESET="custom" ;;
    java-basic|java-checkstyle|python-basic|c-basic|custom) PRESET="$preset_choice" ;;
  esac

  apply_preset_defaults

  TESTS_ROOT="$(prompt_with_default "Test root folder" "$TESTS_ROOT")"
  echo
  PRACTICAL_NAME="$(prompt_with_default "Practical name" "$PRACTICAL_NAME")"
  echo
  COURSE_CODE="$(prompt_with_default "Course code" "$COURSE_CODE")"
  echo
  SRC_DIR="$(prompt_with_default "Source directory" "$SRC_DIR")"
  echo
  COMPILE_COMMAND="$(prompt_with_default "Build command" "$COMPILE_COMMAND")"
  echo
  RUN_COMMAND="$(prompt_with_default "Run command" "$RUN_COMMAND")"
  echo
  SUITE_NAMES_RAW="$(prompt_with_default "Suite names (comma-separated, supports nested paths)" "$SUITE_NAMES_RAW")"
  echo

  if [ "$INCLUDE_CHECKSTYLE" = "yes" ]; then
    if prompt_yes_no "Include CheckStyle scaffold?" "y"; then
      INCLUDE_CHECKSTYLE="yes"
    else
      INCLUDE_CHECKSTYLE="no"
    fi
  else
    if prompt_yes_no "Include CheckStyle scaffold?" "n"; then
      INCLUDE_CHECKSTYLE="yes"
    else
      INCLUDE_CHECKSTYLE="no"
    fi
  fi
fi

if [ -z "$TESTS_ROOT" ] || [ -z "$PRACTICAL_NAME" ] || [ -z "$COURSE_CODE" ] || \
   [ -z "$SRC_DIR" ] || [ -z "$COMPILE_COMMAND" ] || [ -z "$RUN_COMMAND" ] || \
   [ -z "$SUITE_NAMES_RAW" ]; then
  echo "Missing required values."
  exit 1
fi

mapfile -t SUITE_NAMES < <(normalise_suite_names "$SUITE_NAMES_RAW")

if [ "${#SUITE_NAMES[@]}" -eq 0 ]; then
  echo "No valid suite names were provided."
  exit 1
fi

echo
echo "Creating stacscheck scaffold with:"
echo "  Preset:         $PRESET"
echo "  Test root:      $TESTS_ROOT"
echo "  Practical:      $PRACTICAL_NAME"
echo "  Course:         $COURSE_CODE"
echo "  Source dir:     $SRC_DIR"
echo "  Build command:  $COMPILE_COMMAND"
echo "  Run command:    $RUN_COMMAND"
echo "  Suites:"
for suite_name in "${SUITE_NAMES[@]}"; do
  echo "    - $suite_name"
done
echo "  CheckStyle:     $INCLUDE_CHECKSTYLE"
echo "  Overwrite:      $FORCE_OVERWRITE"
echo

mkdir -p "$TESTS_ROOT"

PRACTICAL_CONFIG_CONTENT="[info]
practical = $PRACTICAL_NAME
course = $COURSE_CODE
srcdir = $SRC_DIR
"

write_file "$TESTS_ROOT/practical.config" "$PRACTICAL_CONFIG_CONTENT"

for suite_name in "${SUITE_NAMES[@]}"; do
  suite_dir="$TESTS_ROOT/$suite_name"
  mkdir -p "$suite_dir"

  BUILD_ALL_CONTENT="#!/bin/bash
set -e

$COMPILE_COMMAND
"

  PROG_RUN_CONTENT="#!/bin/bash

$RUN_COMMAND
"

  write_file "$suite_dir/build-all.sh" "$BUILD_ALL_CONTENT"
  write_file "$suite_dir/prog-run.sh" "$PROG_RUN_CONTENT"

  make_executable_if_exists "$suite_dir/build-all.sh"
  make_executable_if_exists "$suite_dir/prog-run.sh"
done

if [ "$INCLUDE_CHECKSTYLE" = "yes" ]; then
  mkdir -p "$TESTS_ROOT/CheckStyle"
  mkdir -p "$TESTS_ROOT/libs"

  CHECKSTYLE_CONFIG_FILE_NAME="$(get_checkstyle_config_file_name "$COURSE_CODE")"

  CHECKSTYLE_BUILD_CONTENT="#!/bin/bash
set -e

$COMPILE_COMMAND
"

  CHECKSTYLE_TEST_CONTENT="#!/bin/bash

JAR_PATH=\"\$TESTDIR/../libs/checkstyle-11.0.1-all.jar\"
CONFIG_PATH=\"\$TESTDIR/$CHECKSTYLE_CONFIG_FILE_NAME\"

if [ ! -f \"\$JAR_PATH\" ]; then
    echo \"Missing CheckStyle jar: \$JAR_PATH\"
    echo \"Place checkstyle-11.0.1-all.jar inside the libs directory.\"
    exit 1
fi

result=\$(java -jar \"\$JAR_PATH\" -c \"\$CONFIG_PATH\" .)
echo \"\$result\"

pass=\$'Starting audit...\nAudit done.'
if [ \"\$result\" != \"\$pass\" ]; then
    echo \"Code does not adhere to style conventions.\"
    exit 1
else
    echo \"Code adheres to style conventions.\"
    exit 0
fi
"

  CHECKSTYLE_XML_CONTENT='<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE module PUBLIC "-//Puppy Crawl//DTD Check Configuration 1.3//EN" "http://www.puppycrawl.com/dtds/configuration_1_3.dtd">

<!--
    Checkstyle-Configuration: St Andrews Checkstyle Configuration
    Description: Presents the naming conventions that are used within NDS research group.
-->
<module name="Checker">
  <property name="severity" value="warning"/>
  <property name="fileExtensions" value="java, properties, xml"/>

  <module name="TreeWalker">
    <module name="JavadocMethod">
      <property name="scope" value="public"/>
      <property name="allowUndeclaredRTE" value="true"/>
      <property name="severity" value="ignore"/>
    </module>
    <module name="JavadocType">
      <property name="scope" value="public"/>
      <property name="severity" value="ignore"/>
    </module>
    <module name="JavadocVariable">
      <property name="scope" value="public"/>
      <property name="severity" value="ignore"/>
    </module>
    <module name="JavadocStyle">
      <property name="checkEmptyJavadoc" value="true"/>
      <property name="checkHtml" value="false"/>
    </module>
    <module name="ConstantName"/>
    <module name="LocalFinalVariableName">
      <property name="format" value="^[a-z][a-zA-Z0-9_]*$"/>
    </module>
    <module name="LocalVariableName">
      <property name="format" value="^[a-z][a-zA-Z0-9_]*$"/>
    </module>
    <module name="MemberName">
      <property name="format" value="^[a-z][a-zA-Z0-9_]*$"/>
    </module>
    <module name="MethodName"/>
    <module name="PackageName"/>
    <module name="ParameterName">
      <property name="format" value="^[a-z][a-zA-Z0-9_]*$"/>
    </module>
    <module name="StaticVariableName">
      <property name="format" value="^[a-z][a-zA-Z0-9_]*$"/>
    </module>
    <module name="TypeName">
      <property name="format" value="^[a-zA-Z0-9]*$"/>
      <property name="tokens" value="INTERFACE_DEF"/>
    </module>
    <module name="AvoidStarImport"/>
    <module name="IllegalImport"/>
    <module name="RedundantImport"/>
    <module name="MethodLength">
      <property name="severity" value="ignore"/>
      <metadata name="net.sf.eclipsecs.core.lastEnabledSeverity" value="inherit"/>
    </module>
    <module name="ParameterNumber">
      <property name="severity" value="ignore"/>
      <metadata name="net.sf.eclipsecs.core.lastEnabledSeverity" value="inherit"/>
    </module>
    <module name="EmptyForIteratorPad"/>
    <module name="GenericWhitespace"/>
    <module name="Indentation"/>
    <module name="MethodParamPad"/>
    <module name="NoWhitespaceAfter"/>
    <module name="NoWhitespaceBefore"/>
    <module name="OperatorWrap"/>
    <module name="ParenPad"/>
    <module name="TypecastParenPad"/>
    <module name="WhitespaceAfter"/>
    <module name="WhitespaceAround">
      <property name="tokens" value="ASSIGN,BAND,BAND_ASSIGN,BOR,BOR_ASSIGN,BSR,BSR_ASSIGN,BXOR,BXOR_ASSIGN,COLON,DIV,DIV_ASSIGN,EQUAL,GE,GT,LAND,LCURLY,LE,LITERAL_ASSERT,LITERAL_CATCH,LITERAL_DO,LITERAL_ELSE,LITERAL_FINALLY,LITERAL_FOR,LITERAL_IF,LITERAL_RETURN,LITERAL_SYNCHRONIZED,LITERAL_TRY,LITERAL_WHILE,LOR,LT,MINUS,MINUS_ASSIGN,MOD,MOD_ASSIGN,NOT_EQUAL,PLUS,PLUS_ASSIGN,QUESTION,SL,SLIST,SL_ASSIGN,SR,SR_ASSIGN,STAR,STAR_ASSIGN,LITERAL_ASSERT,TYPE_EXTENSION_AND,WILDCARD_TYPE"/>
    </module>
    <module name="ModifierOrder"/>
    <module name="RedundantModifier"/>
    <module name="AvoidNestedBlocks"/>
    <module name="EmptyBlock">
      <property name="tokens" value="LITERAL_DO,LITERAL_ELSE,LITERAL_FINALLY,LITERAL_IF,LITERAL_FOR,LITERAL_TRY,LITERAL_WHILE,STATIC_INIT"/>
    </module>
    <module name="LeftCurly"/>
    <module name="NeedBraces"/>
    <module name="EmptyStatement"/>
    <module name="EqualsHashCode"/>
    <module name="IllegalInstantiation"/>
    <module name="InnerAssignment"/>
    <module name="MagicNumber">
        <property name="severity" value="ignore"/>
    </module>
    <module name="MissingSwitchDefault"/>
    <!--<module name="RedundantThrows"/> -->
    <module name="SimplifyBooleanExpression"/>
    <module name="SimplifyBooleanReturn"/>
    <module name="DesignForExtension">
      <property name="severity" value="ignore"/>
      <metadata name="net.sf.eclipsecs.core.lastEnabledSeverity" value="inherit"/>
    </module>
    <module name="FinalClass"/>
    <module name="InterfaceIsType"/>
    <module name="VisibilityModifier">
      <property name="protectedAllowed" value="true"/>
    </module>
    <module name="ArrayTypeStyle"/>
    <!--   <module name="FinalParameters"/> -->
    <module name="TodoComment"/>
    <module name="UpperEll"/>
    <module name="EmptyLineSeparator">
      <property name="allowNoEmptyLineBetweenFields" value="true"/>
      <property name="allowMultipleEmptyLines" value="false"/>
      <property name="allowMultipleEmptyLinesInsideClassMembers" value="false"/>
    </module>
  </module>
  <!--  <module name="JavadocPackage"/> -->
  <module name="NewlineAtEndOfFile">
    <property name="severity" value="ignore"/>
  </module>
  <module name="Translation"/>
  <module name="FileLength"/>
  <module name="FileTabCharacter"/>
  <module name="RegexpSingleline">
    <metadata name="net.sf.eclipsecs.core.comment" value="Trailing space or tab after text (but allow one space after javadoc *)"/>
    <property name="format" value="[^*][\s\t]$"/>
    <property name="message" value="Line has trailing spaces or tabs."/>
    <property name="severity" value="ignore"/>
  </module>
  <module name="RegexpSingleline">
    <metadata name="net.sf.eclipsecs.core.comment" value="Space or tab on empty line"/>
    <property name="format" value="^[\s\t]+$"/>
    <property name="message" value="Line has trailing spaces or tabs."/>
    <!--<property name="severity" value="ignore"/>-->
  </module>
</module>
'

  LIBS_README_CONTENT='Place the CheckStyle jar here if you want to use the CheckStyle scaffold.

Expected file name:
checkstyle-11.0.1-all.jar
'

  write_file "$TESTS_ROOT/CheckStyle/build-all.sh" "$CHECKSTYLE_BUILD_CONTENT"
  write_file "$TESTS_ROOT/CheckStyle/test-CheckStyle.sh" "$CHECKSTYLE_TEST_CONTENT"
  write_file "$TESTS_ROOT/CheckStyle/$CHECKSTYLE_CONFIG_FILE_NAME" "$CHECKSTYLE_XML_CONTENT"
  write_file "$TESTS_ROOT/libs/README.txt" "$LIBS_README_CONTENT"

  make_executable_if_exists "$TESTS_ROOT/CheckStyle/build-all.sh"
  make_executable_if_exists "$TESTS_ROOT/CheckStyle/test-CheckStyle.sh"
fi

echo
echo "Done."
echo
echo "Created test root: $TESTS_ROOT"
echo "Suites:"
for suite_name in "${SUITE_NAMES[@]}"; do
  echo "  - $suite_name"
done
echo "CheckStyle scaffold: $INCLUDE_CHECKSTYLE"