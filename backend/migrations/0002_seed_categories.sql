INSERT INTO categories (slug, name) VALUES
    ('food-drinks',     'Food & Drinks'),
    ('clothing',        'Clothing & Accessories'),
    ('beauty',          'Beauty & Personal Care'),
    ('tech',            'Tech & Gadgets'),
    ('stationery',      'Books & Stationery'),
    ('art-crafts',      'Art & Crafts'),
    ('tutoring',        'Tutoring & Academic Help'),
    ('design',          'Design & Creative Services'),
    ('it-services',     'IT & Software Services'),
    ('events',          'Events & Photography'),
    ('other',           'Other')
ON CONFLICT (slug) DO NOTHING;
