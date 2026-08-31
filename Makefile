# Install the toolbox commands into ~/.dsh/tools/bin (add it to PATH).
PREFIX ?= $(HOME)/.dsh/tools/bin

BINS = \
  packages/session-care/bin/dtb-session-care.mjs \
  packages/harness-patch/bin/dtb-harness-patch.mjs

install:
	mkdir -p $(PREFIX) node_modules/@dsh-toolbox
	@if [ ! -e node_modules/@dsh-toolbox/core ]; then ln -sfn ../../packages/core node_modules/@dsh-toolbox/core; echo "linked node_modules/@dsh-toolbox/core"; fi
	@for b in $(BINS); do \
	  name=$$(basename $${b%.mjs}); \
	  ln -sf $(CURDIR)/$$b $(PREFIX)/$$name; \
	  echo "linked $(PREFIX)/$$name -> $(CURDIR)/$$b"; \
	done
	@echo "add '$(PREFIX)' to your PATH"

uninstall:
	@for b in $(BINS); do \
	  name=$$(basename $${b%.mjs}); \
	  rm -f $(PREFIX)/$$name; \
	done

.PHONY: install uninstall
