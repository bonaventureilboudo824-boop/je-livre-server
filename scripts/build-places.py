#!/usr/bin/env python3
"""Construit data/places-bf.json (lieux du Burkina Faso) a partir de GeoNames (BF.txt, licence CC BY 4.0).
Usage : python3 scripts/build-places.py scripts/.geonames-BF.txt data/places-bf.json"""
import csv, json, re, sys, unicodedata

TYPES = {'PPL': 'Quartier / localité', 'PPLX': 'Quartier', 'PPLA': 'Ville', 'PPLA2': 'Ville', 'PPLA3': 'Ville', 'PPLC': 'Capitale',
         'HTL': 'Hôtel', 'BANK': 'Banque', 'MSQE': 'Mosquée', 'UNIV': 'Université', 'SCH': 'École', 'PAL': 'Palais', 'INDS': 'Zone industrielle',
         'MKT': 'Marché', 'HSP': 'Hôpital', 'AIRP': 'Aéroport', 'STNB': 'Gare', 'RSTN': 'Gare', 'CH': 'Église', 'MUS': 'Musée', 'STDM': 'Stade',
         'RSV': 'Réserve', 'MN': 'Monument', 'BLDG': 'Bâtiment', 'PRK': 'Parc', 'MALL': 'Centre commercial', 'PO': 'Poste', 'LIBR': 'Bibliothèque'}
OUAGA = (12.25, 12.50, -1.70, -1.35)  # lat min/max, lng min/max

def norm(s):
    s = unicodedata.normalize('NFD', s.lower())
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    s = re.sub(r"[’'`\-_/.,()]", ' ', s)
    return re.sub(r'\s+', ' ', s).strip()

def main(src, dst):
    out, seen = {}, set()
    for r in csv.reader(open(src, encoding='utf-8'), delimiter='\t'):
        gid, name, ascii_, alts, lat, lng, fcl, fcode = r[0], r[1], r[2], r[3], float(r[4]), float(r[5]), r[6], r[7]
        in_ouaga = OUAGA[0] <= lat <= OUAGA[1] and OUAGA[2] <= lng <= OUAGA[3]
        keep = fcl == 'P' or fcode in ('ADM2', 'AIRP') or (in_ouaga and fcl in ('S', 'L') and fcode in TYPES)
        if not keep or not name.strip():
            continue
        label = TYPES.get(fcode, 'Lieu')
        rec = {'n': name.strip()[:80], 'k': norm(name), 'lat': round(lat, 5), 'lng': round(lng, 5), 't': label, 's': 'geonames'}
        if in_ouaga: rec['o'] = 1
        out['g' + gid] = rec
        seen.add((rec['k'], round(lat, 3), round(lng, 3)))
        if in_ouaga or fcode in ('PPLA', 'PPLA2', 'PPLA3', 'PPLC'):
            for i, a in enumerate([x for x in alts.split(',') if x][:6]):
                k = norm(a)
                if len(k) < 3 or k == rec['k'] or (k, round(lat, 3), round(lng, 3)) in seen: continue
                seen.add((k, round(lat, 3), round(lng, 3)))
                out['g%s_%d' % (gid, i)] = {**rec, 'k': k}
    json.dump(out, open(dst, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print(len(out), 'lieux ->', dst)

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
