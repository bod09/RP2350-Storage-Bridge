#ifndef FFCONF_H
#define FFCONF_H

// FatFS configuration for RP2350 Storage Bridge
// Overrides the default ffconf.h shipped with FatFS

#define FF_FS_READONLY    0     // Read-write
#define FF_FS_MINIMIZE    0     // Full API
#define FF_USE_FIND       1     // f_findfirst / f_findnext
#define FF_USE_MKFS       0     // No formatting support
#define FF_USE_FASTSEEK   0
#define FF_USE_EXPAND     0
#define FF_USE_CHMOD      0
#define FF_USE_LABEL      1     // Read volume labels
#define FF_USE_FORWARD    0

#define FF_USE_LFN        1     // Long filename support (static buffer)
#define FF_MAX_LFN        255
#define FF_LFN_UNICODE    0     // ANSI/OEM encoding
#define FF_LFN_BUF        255
#define FF_SFN_BUF        12
#define FF_STRF_ENCODE    3

#define FF_CODE_PAGE      437   // US English

#define FF_FS_RPATH       2     // Relative path + getcwd
#define FF_VOLUMES        1     // Single volume
#define FF_STR_VOLUME_ID  0
#define FF_MULTI_PARTITION 0

#define FF_MIN_SS         512
#define FF_MAX_SS         4096  // Some drives use 4K sectors

#define FF_FS_EXFAT       1     // exFAT support (patents donated to OIN 2019)
#define FF_FS_NORTC       1     // No RTC — use fixed timestamp
#define FF_NORTC_MON      1
#define FF_NORTC_MDAY     1
#define FF_NORTC_YEAR     2024

#define FF_FS_NOFSINFO    0
#define FF_FS_LOCK        0     // No file locking (single-threaded)
#define FF_FS_REENTRANT   0

#endif // FFCONF_H
