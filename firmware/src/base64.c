#include "base64.h"

static const char enc_table[] =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

static const uint8_t dec_table[256] = {
    ['A']=0,  ['B']=1,  ['C']=2,  ['D']=3,  ['E']=4,  ['F']=5,  ['G']=6,  ['H']=7,
    ['I']=8,  ['J']=9,  ['K']=10, ['L']=11, ['M']=12, ['N']=13, ['O']=14, ['P']=15,
    ['Q']=16, ['R']=17, ['S']=18, ['T']=19, ['U']=20, ['V']=21, ['W']=22, ['X']=23,
    ['Y']=24, ['Z']=25,
    ['a']=26, ['b']=27, ['c']=28, ['d']=29, ['e']=30, ['f']=31, ['g']=32, ['h']=33,
    ['i']=34, ['j']=35, ['k']=36, ['l']=37, ['m']=38, ['n']=39, ['o']=40, ['p']=41,
    ['q']=42, ['r']=43, ['s']=44, ['t']=45, ['u']=46, ['v']=47, ['w']=48, ['x']=49,
    ['y']=50, ['z']=51,
    ['0']=52, ['1']=53, ['2']=54, ['3']=55, ['4']=56, ['5']=57, ['6']=58, ['7']=59,
    ['8']=60, ['9']=61,
    ['+']=62, ['/']=63,
};

int base64_encode(const uint8_t* in, int in_len, char* out, int out_max) {
    int o = 0;
    for (int i = 0; i < in_len; i += 3) {
        if (o + 4 >= out_max) break;
        uint32_t v = (uint32_t)in[i] << 16;
        if (i + 1 < in_len) v |= (uint32_t)in[i + 1] << 8;
        if (i + 2 < in_len) v |= (uint32_t)in[i + 2];

        out[o++] = enc_table[(v >> 18) & 0x3F];
        out[o++] = enc_table[(v >> 12) & 0x3F];
        out[o++] = (i + 1 < in_len) ? enc_table[(v >> 6) & 0x3F] : '=';
        out[o++] = (i + 2 < in_len) ? enc_table[v & 0x3F] : '=';
    }
    out[o] = '\0';
    return o;
}

int base64_decode(const char* in, int in_len, uint8_t* out, int out_max) {
    int o = 0;
    for (int i = 0; i < in_len; i += 4) {
        if (in[i] == '=' || in[i] == '\0') break;

        uint32_t v = (uint32_t)dec_table[(uint8_t)in[i]] << 18;
        v |= (i + 1 < in_len && in[i+1] != '=') ? (uint32_t)dec_table[(uint8_t)in[i+1]] << 12 : 0;
        v |= (i + 2 < in_len && in[i+2] != '=') ? (uint32_t)dec_table[(uint8_t)in[i+2]] << 6 : 0;
        v |= (i + 3 < in_len && in[i+3] != '=') ? (uint32_t)dec_table[(uint8_t)in[i+3]] : 0;

        if (o < out_max) out[o++] = (uint8_t)(v >> 16);
        if (i + 2 < in_len && in[i+2] != '=' && o < out_max) out[o++] = (uint8_t)(v >> 8);
        if (i + 3 < in_len && in[i+3] != '=' && o < out_max) out[o++] = (uint8_t)(v);
    }
    return o;
}
