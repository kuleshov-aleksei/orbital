# Cross-compiles the Windows audio helper (Rust) on Linux. Needs the
# x86_64-pc-windows-gnu target (rustup target add x86_64-pc-windows-gnu) and
# the mingw-w64 C toolchain as linker (Debian gcc-mingw-w64-x86-64, Arch
# mingw-w64-gcc). Target and linker are set in .cargo/config.toml.
# See docs/specs/WINDOWS_APP_AUDIO.md.

CARGO ?= cargo
TARGET := orbital-audiocap.exe
BUILT := target/x86_64-pc-windows-gnu/release/$(TARGET)

# cargo tracks its own dependencies; always let it decide what to rebuild.
$(TARGET): FORCE
	$(CARGO) build --release --locked
	cp $(BUILT) $(TARGET)

clean:
	$(CARGO) clean
	rm -f $(TARGET)

FORCE:

.PHONY: clean FORCE
