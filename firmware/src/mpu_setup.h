#ifndef MPU_SETUP_H
#define MPU_SETUP_H

// Configure ARM Cortex-M33 MPU for W^X memory protection.
// Call once from main() before enabling USB or processing any untrusted data.
//
// Protection provided:
//   Flash:   Read-Only + Executable  (prevents flash modification via memory-mapped writes)
//   RAM code (.data section with time_critical): RW + Executable  (PIO USB timing code)
//   RAM data (BSS + heap): RW + No Execute  (serial_buf, file_buf — main overflow targets)
//   Stack (SCRATCH_X/Y): RW + No Execute  (prevents stack shellcode execution)
//
// Any MPU violation triggers MemManage fault -> HardFault -> watchdog reset.
void mpu_setup(void);

#endif // MPU_SETUP_H
