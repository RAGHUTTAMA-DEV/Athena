import json
import os

p1 = r"scratch/uploads/chat_1794425036226/att_1794425074802_6udda2-DocScanner 06-May-2025 12-08 pm.pdf.parsed.json"
p2 = r"scratch/uploads/chat_1794425036226/att_1794425074724_0hjmjw-Sale Deed_Draft V1.docx.parsed.json"
p3 = r"scratch/uploads/sess_verify_1/att_1794424964763_iepbza-sale_deed_with_index.pdf.parsed.json"

for name, p in [("DocScanner PDF", p1), ("Sale Deed Draft DOCX", p2), ("Sale Deed Index PDF", p3)]:
    if os.path.exists(p):
        with open(p, "r", encoding="utf-8") as f:
            data = json.load(f)
        print(f"=== {name} ===")
        print(f"Keys: {list(data.keys())}")
        text = data.get("text", "")
        print(f"Text length: {len(text)}")
        # Save extracted text to plain text file for detailed inspection
        txt_path = p + ".extracted.txt"
        with open(txt_path, "w", encoding="utf-8") as tf:
            tf.write(text)
        print(f"Saved text to {txt_path}\n")
