import glob
import os
import re
import struct


def parse_po(file_path):
    """Parse a GNU gettext PO file into a dictionary."""
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    entries = {}
    pattern = re.compile(
        r'msgid\s+((?:"(?:\\.|[^"\\])*"\s*)+)\s*msgstr\s+((?:"(?:\\.|[^"\\])*"\s*)+)',
        re.MULTILINE,
    )

    def extract_str(block):
        lines = re.findall(r'"((?:\\.|[^"\\])*)"', block)
        combined = ''.join(lines)
        return (
            combined
            .replace(r'\"', '"')
            .replace(r'\\', '\\')
            .replace(r'\n', '\n')
            .replace(r'\t', '\t')
        )

    for match in pattern.finditer(content):
        msgid = extract_str(match.group(1))
        msgstr = extract_str(match.group(2))
        entries[msgid] = msgstr

    return entries


def make_mo(catalog):
    """Compile a translation dictionary into binary GNU gettext MO format."""
    keys = sorted(catalog.keys(), key=lambda k: k.encode('utf-8'))
    num_strings = len(keys)
    header_size = 28
    table_size = num_strings * 8
    orig_table_offset = header_size
    trans_table_offset = orig_table_offset + table_size
    orig_data = b''
    trans_data = b''
    orig_indices = []
    trans_indices = []
    current_offset = trans_table_offset + table_size

    for k in keys:
        kb = k.encode('utf-8') + b'\x00'
        orig_indices.append((len(kb) - 1, current_offset))
        current_offset += len(kb)
        orig_data += kb

    for k in keys:
        vb = catalog[k].encode('utf-8') + b'\x00'
        trans_indices.append((len(vb) - 1, current_offset))
        current_offset += len(vb)
        trans_data += vb

    header = struct.pack(
        '<Iiiiiii',
        0x950412DE,
        0,
        num_strings,
        orig_table_offset,
        trans_table_offset,
        0,
        0,
    )
    orig_table = b''.join(struct.pack('<ii', length, offset) for length, offset in orig_indices)
    trans_table = b''.join(struct.pack('<ii', length, offset) for length, offset in trans_indices)
    return header + orig_table + trans_table + orig_data + trans_data


def compile_all():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    po_dir = os.path.join(base_dir, 'po')
    locale_dir = os.path.join(base_dir, 'locale')

    po_files = sorted(glob.glob(os.path.join(po_dir, '*.po')))
    if not po_files:
        print(f'No PO files found in {po_dir}')
        return

    for po_file in po_files:
        lang = os.path.splitext(os.path.basename(po_file))[0]
        catalog = parse_po(po_file)
        mo_data = make_mo(catalog)

        target_dir = os.path.join(locale_dir, lang, 'LC_MESSAGES')
        os.makedirs(target_dir, exist_ok=True)

        mo_path = os.path.join(target_dir, 'novus-daynight.mo')
        with open(mo_path, 'wb') as f:
            f.write(mo_data)

        print(f'Compiled [{lang}]: {len(catalog)} strings -> {mo_path}')


if __name__ == '__main__':
    compile_all()
