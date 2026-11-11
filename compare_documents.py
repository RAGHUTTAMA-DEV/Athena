import re

with open(r"scratch/uploads/chat_1794425036226/att_1794425074802_6udda2-DocScanner 06-May-2025 12-08 pm.pdf.parsed.json.extracted.txt", "r", encoding="utf-8") as f:
    doc1 = f.read()

with open(r"scratch/uploads/chat_1794425036226/att_1794425074724_0hjmjw-Sale Deed_Draft V1.docx.parsed.json.extracted.txt", "r", encoding="utf-8") as f:
    doc2 = f.read()

print("--- DOC 1: DocScanner PDF Overview ---")
lines1 = doc1.splitlines()
print(f"Total lines: {len(lines1)}")

print("\n--- DOC 2: Sale Deed Draft DOCX Overview ---")
lines2 = doc2.splitlines()
print(f"Total lines: {len(lines2)}")

# Let's write out full text or write a python script that searches for specific entities:
# Vendors, Purchasers, Property site number, Khata number, Dimensions, Boundaries, Consideration amount, Payment details, Dates, Encumbrance, etc.

def extract_key_info(txt, doc_name):
    print(f"================ {doc_name} ================")
    # Find names, amounts, site nos, khata nos, dates
    amounts = re.findall(r'Rs\.?\s*[\d,]+|-?|Rupees.*?(?=\.|\n)', txt, re.IGNORECASE)
    print("Amounts mentioned:")
    for a in set(amounts[:20]):
        if len(a.strip()) > 3:
            print("  -", a.strip())
            
    print("\nDates mentioned:")
    dates = re.findall(r'\b\d{1,2}[-/\.]\d{1,2}[-/\.]\d{2,4}\b|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}\b', txt, re.IGNORECASE)
    for d in set(dates[:15]):
        print("  -", d)

extract_key_info(doc1, "DocScanner PDF")
extract_key_info(doc2, "Sale Deed Draft DOCX")
