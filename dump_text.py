import sys
sys.stdout.reconfigure(encoding='utf-8')

with open(r"scratch/uploads/chat_1794425036226/att_1794425074802_6udda2-DocScanner 06-May-2025 12-08 pm.pdf.parsed.json.extracted.txt", "r", encoding="utf-8") as f:
    doc1 = f.read()

with open(r"scratch/uploads/chat_1794425036226/att_1794425074724_0hjmjw-Sale Deed_Draft V1.docx.parsed.json.extracted.txt", "r", encoding="utf-8") as f:
    doc2 = f.read()

print("=== DOC 1 (DocScanner PDF) - FIRST 3000 CHARS ===")
print(doc1[:3000])
print("\n" + "="*50 + "\n")

print("=== DOC 2 (Sale Deed Draft DOCX) - FULL TEXT ===")
print(doc2)
