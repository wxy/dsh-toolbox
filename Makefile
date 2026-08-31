# Install the toolbox commands into ~/.dsh/tools/bin (add it to PATH).
PREFIX ?= $(HOME)/.dsh/tools/bin

BINS = \
  packages/session-care/bin/session-care.mjs \
  packages/harness-patch/bin/harness-patch.mjs \
  packages/workspace-ops/bin/workspace-ops.mjs

install:
	mkdir -p $(PREFIX)
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
