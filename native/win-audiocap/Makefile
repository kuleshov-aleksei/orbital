# Cross-compiles the Windows audio helper with mingw-w64 (Debian package
# g++-mingw-w64-x86-64). See docs/specs/WINDOWS_APP_AUDIO.md.
# make's built-in CXX default is the host g++, so override it unless the
# caller set one explicitly.
ifeq ($(origin CXX),default)
CXX := x86_64-w64-mingw32-g++
endif

TARGET := orbital-audiocap.exe

$(TARGET): audiocap.cpp
	$(CXX) -std=c++17 -O2 -Wall -Wextra -static -municode -o $@ $< \
		-lole32 -luuid -lversion

clean:
	rm -f $(TARGET)

.PHONY: clean
