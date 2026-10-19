-- Сайттегі ойдан шығарылған мамандар мен филиалдарға арналған бастапқы деректер.
-- Қайта іске қосқанда бар деректі қайталамай жаңартады.

INSERT INTO branches (public_code, name, address, map_url)
VALUES
  ('naz', 'Назарбаева филиалы', 'Назарбаева 262/1, Алматы', 'https://maps.google.com/?q=Nazarbayev+262%2F1+Almaty'),
  ('utep', 'Өтепова филиалы', 'Өтепова 29, Алматы', 'https://maps.google.com/?q=Utepova+29+Almaty')
ON CONFLICT (public_code) DO UPDATE SET
  name = EXCLUDED.name,
  address = EXCLUDED.address,
  map_url = EXCLUDED.map_url,
  is_active = TRUE;

INSERT INTO doctors (public_code, full_name, specialty, description, experience_years)
VALUES
  ('aidos', 'Айдос Халило Серікұлы', 'Терапевт', 'Ересектерге алғашқы медициналық кеңес', 8),
  ('ainur', 'Айнұр Қасымова Ерланқызы', 'Педиатр', 'Балалар денсаулығы және профилактика', 7),
  ('dias', 'Диас Мұратов Болатұлы', 'Кардиолог', 'Жүрек пен қан тамырларын бақылау', 10),
  ('madina', 'Мәдина Оразбаева Нұрланқызы', 'Невролог', 'Жүйке жүйесі бойынша кеңес', 6),
  ('timur', 'Тимур Әлиев Қанатұлы', 'Ортопед', 'Қимыл-қозғалыс жүйесін бағалау', 9),
  ('zhanna', 'Жанат Сейітов Маратұлы', 'Дерматолог', 'Тері саулығы және күтім кеңестері', 5),
  ('ruslan', 'Руслан Бекенов Талғатұлы', 'Оториноларинголог', 'Құлақ, мұрын, тамақ бойынша кеңес', 11),
  ('aliya', 'Әлия Нұрғазина Саматқызы', 'Эндокринолог', 'Гормондық саулықты бақылау', 8),
  ('marat', 'Марат Жұмабеков Ермекұлы', 'Уролог', 'Ересектерге урологиялық кеңес', 12),
  ('kamila', 'Кәмилә Төлегенова Әсетқызы', 'Гинеколог', 'Әйелдер денсаулығы бойынша кеңес', 7)
ON CONFLICT (public_code) DO UPDATE SET
  full_name = EXCLUDED.full_name,
  specialty = EXCLUDED.specialty,
  description = EXCLUDED.description,
  experience_years = EXCLUDED.experience_years,
  is_active = TRUE;

INSERT INTO doctor_branches (doctor_id, branch_id)
SELECT d.id, b.id
FROM (VALUES
  ('aidos', 'naz'), ('ainur', 'utep'), ('dias', 'naz'), ('madina', 'utep'),
  ('timur', 'naz'), ('zhanna', 'utep'), ('ruslan', 'naz'), ('aliya', 'utep'),
  ('marat', 'naz'), ('kamila', 'utep')
) AS assignment(doctor_code, branch_code)
JOIN doctors d ON d.public_code = assignment.doctor_code
JOIN branches b ON b.public_code = assignment.branch_code
ON CONFLICT DO NOTHING;

INSERT INTO services (public_code, name, price_kzt, duration_minutes)
VALUES
  ('therapist', 'Терапевт кеңесі', 8000, 30),
  ('pediatrician', 'Педиатр кеңесі', 9000, 30),
  ('specialist', 'Тар маман кеңесі', 12000, 40)
ON CONFLICT (public_code) DO UPDATE SET
  name = EXCLUDED.name,
  price_kzt = EXCLUDED.price_kzt,
  duration_minutes = EXCLUDED.duration_minutes,
  is_active = TRUE;
