#!/bin/sh
# Run the RHINO Markdown and config checks declared in repo-config.yml.
# Runs every check, then exits 1 if any failed, so one run shows all problems.
set -u

cd "$(dirname "$0")/.."

if [ -x .tools/rhino ]; then
	RHINO=.tools/rhino
elif command -v rhino >/dev/null 2>&1; then
	RHINO=rhino
else
	echo "rhino not found. Run: npm run docs:install" >&2
	exit 2
fi

failed=0
for check in "repo-config validate" "md internal-link validate" "md heading-hierarchy validate"; do
	# shellcheck disable=SC2086
	"$RHINO" $check || failed=1
done

exit "$failed"
