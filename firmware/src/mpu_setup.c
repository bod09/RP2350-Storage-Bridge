#include "mpu_setup.h"
#include "hardware/structs/mpu.h"
#include "hardware/structs/scb.h"
#include "hardware/sync.h"

// Linker-provided symbol for BSS start (boundary between code+data and BSS+heap)
extern char __bss_start__;

// Memory attribute indices (MAIR slot assignments)
#define ATTR_IDX_WT  0   // Write-Through, Read-Allocate (for Flash)
#define ATTR_IDX_WB  1   // Write-Back, Read+Write Allocate (for RAM)

// PMSAv8 memory attribute encoding: NT=Non-Transient, WB=Write-Back, RA=Read-Alloc, WA=Write-Alloc
#define MEM_ATTR(nt, wb, ra, wa) \
    ((((nt) & 1u) << 3) | (((wb) & 1u) << 2) | (((ra) & 1u) << 1) | ((wa) & 1u))

// Combine outer + inner attributes into one 8-bit MAIR entry
#define MAIR_ATTR(outer, inner)  (((outer) << 4) | (inner))

// RBAR helpers: AP field is bits [2:1], SH is bits [4:3], XN is bit [0]
#define RBAR(base, sh, ro, xn) \
    (((base) & 0xFFFFFFE0u) | (((sh) & 3u) << 3) | (((ro) & 1u) << 2) | ((xn) & 1u))
// Note: AP encoding: bit2=RO, bit1=NP (non-privileged). We only use privileged, so NP=0 always.
// The actual HW field is AP[2:1] where bit2=RO, bit1=NP.
// SDK defines AP at bits [2:1] of RBAR. So RO goes to bit 2, NP to bit 1.

// RLAR helper: LIMIT is bits [31:5], ATTRINDX is bits [3:1], EN is bit [0]
#define RLAR(limit, attr_idx) \
    (((limit) & 0xFFFFFFE0u) | (((attr_idx) & 7u) << 1) | 1u)

void mpu_setup(void) {
    // Disable MPU during configuration
    __dmb();
    mpu_hw->ctrl = 0;

    // --- Memory Attributes (MAIR0 register) ---
    // Attr 0: Normal, Write-Through, Non-Transient, Read-Allocate (flash)
    // Attr 1: Normal, Write-Back, Non-Transient, Read+Write Allocate (RAM)
    uint8_t attr0 = MAIR_ATTR(MEM_ATTR(1,0,1,0), MEM_ATTR(1,0,1,0));  // WT-RA
    uint8_t attr1 = MAIR_ATTR(MEM_ATTR(1,1,1,1), MEM_ATTR(1,1,1,1));  // WB-RAWA
    mpu_hw->mair[0] = (uint32_t)attr0 | ((uint32_t)attr1 << 8);

    // --- Region 0: Flash (Read-Only + Executable) ---
    // 0x10000000 - 0x1FFFFFFF (entire XIP address space)
    // Prevents code from writing to flash via memory-mapped access
    mpu_hw->rnr = 0;
    mpu_hw->rbar = RBAR(0x10000000, 0, 1, 0);  // SH=Non, RO=1, XN=0 (executable)
    mpu_hw->rlar = RLAR(0x1FFFFFFF, ATTR_IDX_WT);

    // --- Region 1: RAM code section (RW + Executable) ---
    // 0x20000000 to __bss_start__ (aligned down to 32 bytes)
    // Contains .data + .time_critical code (PIO USB bit-banging routines)
    // These functions use __not_in_flash() and MUST be executable in RAM
    uint32_t bss_start = (uint32_t)&__bss_start__;
    uint32_t ram_code_limit = (bss_start - 1) & ~0x1Fu;  // align down to 32-byte boundary

    mpu_hw->rnr = 1;
    mpu_hw->rbar = RBAR(0x20000000, 0, 0, 0);  // SH=Non, RO=0 (RW), XN=0 (executable)
    mpu_hw->rlar = RLAR(ram_code_limit, ATTR_IDX_WB);

    // --- Region 2: RAM data section (RW + No Execute) ---
    // __bss_start__ to end of main SRAM (0x2007FFFF)
    // Contains BSS (serial_buf[32KB], file_buf, etc.) and heap
    // These are the primary buffer overflow targets — must not be executable
    uint32_t ram_data_base = bss_start & ~0x1Fu;  // align down to 32-byte boundary

    mpu_hw->rnr = 2;
    mpu_hw->rbar = RBAR(ram_data_base, 0, 0, 1);  // SH=Non, RO=0 (RW), XN=1 (no execute)
    mpu_hw->rlar = RLAR(0x2007FFFF, ATTR_IDX_WB);

    // --- Region 3: SCRATCH_X (RW + No Execute) ---
    // 0x20080000 - 0x20080FFF (4KB, core 1 stack)
    mpu_hw->rnr = 3;
    mpu_hw->rbar = RBAR(0x20080000, 0, 0, 1);  // XN
    mpu_hw->rlar = RLAR(0x20080FFF, ATTR_IDX_WB);

    // --- Region 4: SCRATCH_Y (RW + No Execute) ---
    // 0x20081000 - 0x20081FFF (4KB, core 0 main stack)
    mpu_hw->rnr = 4;
    mpu_hw->rbar = RBAR(0x20081000, 0, 0, 1);  // XN
    mpu_hw->rlar = RLAR(0x20081FFF, ATTR_IDX_WB);

    // Enable MemManage fault handler (otherwise MPU faults escalate to HardFault)
    scb_hw->shcsr |= M33_SHCSR_MEMFAULTENA_BITS;

    // Enable MPU with PRIVDEFENA — unmapped regions (peripherals, ROM, PPB)
    // use the default memory map, so we don't need explicit regions for them
    mpu_hw->ctrl = M33_MPU_CTRL_PRIVDEFENA_BITS | M33_MPU_CTRL_ENABLE_BITS;

    __dsb();
    __isb();
}
