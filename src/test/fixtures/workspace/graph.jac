node Weather {
    has temp: int = 80;
}

node Time {
    has hour: int = 12;
}

with entry {
    root ++> Weather();
    root ++> Time();
}