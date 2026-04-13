// Wrapper to compile FatFS ff.c with our ffconf.h.
// By including the source from here, GCC's quoted-include search starts
// in src/ (this file's directory), finding our ff.h and ffconf.h first.
#include "../pico-sdk/lib/tinyusb/lib/fatfs/source/ff.c"
