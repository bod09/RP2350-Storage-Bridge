#ifndef BOARD_H
#define BOARD_H

#ifdef BOARD_WAVESHARE_RP2350A
#include "board_waveshare_rp2350a.h"
#else
#error "No board defined — set BOARD_WAVESHARE_RP2350A"
#endif

#endif // BOARD_H
