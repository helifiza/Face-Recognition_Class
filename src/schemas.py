from datetime import date, time
from typing import Literal
from pydantic import BaseModel, Field, ConfigDict, model_validator


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, allow_inf_nan=False)


class Student(Input):
    student_id: str = Field(min_length=1, max_length=100)
    full_name: str = Field(min_length=1, max_length=200)
    class_name: str | None = None
    faculty: str | None = None
    email: str | None = None


class Course(Input):
    course_id: str = Field(min_length=1, max_length=100)
    course_name: str = Field(min_length=1, max_length=200)
    lecturer: str | None = None


class Enrollment(Input):
    student_id: str
    course_id: str


class ClassSession(Input):
    course_id: str
    session_date: date
    start_time: time
    end_time: time
    room: str | None = None

    @model_validator(mode="after")
    def check_times(self):
        if self.end_time <= self.start_time:
            raise ValueError("end_time must be later than start_time")
        return self


class SessionStatus(Input):
    status: Literal["SCHEDULED", "OPEN", "CLOSED"]


class VectorQuery(Input):
    embedding: list[float] = Field(min_length=512, max_length=512)
    limit: int = Field(default=5, ge=1, le=100)
