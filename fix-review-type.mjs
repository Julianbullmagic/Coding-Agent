import fs from 'fs';
import path from 'path';

const p = path.join('src', 'business-reviews.ts');
let src = fs.readFileSync(p, 'utf8');

const old = "    const reviews: BusinessResult['reviews'] = (result.reviews ?? []).map((review: any) => ({";
const neu = "    const reviews: NonNullable<BusinessResult['reviews']> = (result.reviews ?? []).map((review: any) => ({";
if (src.includes(old)) {
    src = src.replace(old, neu);
    console.log('type annotation fixed');
} else {
    console.log('marker NOT FOUND');
}
fs.writeFileSync(p, src);
